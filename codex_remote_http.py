#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
from collections import deque
import errno
import fcntl
import json
import logging
import os
import pty
import signal
import shlex
import socket
import struct
import subprocess
import tempfile
import termios
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"
VENDOR_FILES = {
    "/vendor/xterm.js": ROOT / "node_modules" / "@xterm" / "xterm" / "lib" / "xterm.js",
    "/vendor/xterm.css": ROOT / "node_modules" / "@xterm" / "xterm" / "css" / "xterm.css",
    "/vendor/addon-fit.js": ROOT / "node_modules" / "@xterm" / "addon-fit" / "lib" / "addon-fit.js",
}
STATIC_FILES = {
    "/": STATIC_DIR / "index.html",
    "/app.js": STATIC_DIR / "app.js",
    "/style.css": STATIC_DIR / "style.css",
    "/shortcuts.json": STATIC_DIR / "shortcuts.json",
}
MAX_EVENT_HISTORY = 2048
QUIET_HTTP_PATHS = frozenset({"/api/input", "/api/resize", "/api/state", "/api/snapshot"})
SUPPRESSED_HTTP_SUCCESS_PATHS = frozenset({"/api/events"})


class TerminalSession:
    def __init__(
        self,
        command: list[str],
        cwd: Path,
        cols: int = 120,
        rows: int = 34,
        *,
        event_history_limit: int = MAX_EVENT_HISTORY,
        logger: logging.Logger | None = None,
    ) -> None:
        self.command = command
        self.cwd = cwd
        self.cols = cols
        self.rows = rows
        self.log = logger or logging.getLogger("codex.session")
        self.proc: subprocess.Popen[bytes] | None = None
        self.master_fd: int | None = None
        self.exit_code: int | None = None
        self.started_at: float | None = None
        self.last_output_at: float | None = None
        self._transcript = tempfile.SpooledTemporaryFile(max_size=1024 * 1024, mode="w+b")
        self._next_event_id = 1
        self._events: deque[dict[str, Any]] = deque(maxlen=max(64, event_history_limit))
        self._turn_seq = 0
        self._active_turn_seq: int | None = None
        self._responded_turn_seq: int | None = None
        self._waiting_turn_seq: int | None = None
        self._lock = threading.RLock()
        self._cv = threading.Condition(self._lock)

    def start(self) -> None:
        with self._lock:
            restarting = self.proc is not None
            if restarting:
                self.log.info("restarting hosted command")
            self._stop_locked()
            self._events.clear()
            self._reset_transcript_locked()
            self.exit_code = None
            self.started_at = time.time()
            self.last_output_at = None
            self._reset_indicator_tracking_locked()
            self._append_event_locked("reset", {"at": self.started_at})

            master_fd, slave_fd = pty.openpty()
            self._set_winsize(slave_fd, self.cols, self.rows)
            self.master_fd = master_fd

            env = os.environ.copy()
            env.update(
                {
                    "TERM": "xterm-256color",
                    "COLORTERM": "truecolor",
                    "COLUMNS": str(self.cols),
                    "LINES": str(self.rows),
                }
            )

            def setup_child() -> None:
                os.setsid()
                fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)

            try:
                self.proc = subprocess.Popen(
                    self.command,
                    cwd=str(self.cwd),
                    stdin=slave_fd,
                    stdout=slave_fd,
                    stderr=slave_fd,
                    close_fds=True,
                    env=env,
                    preexec_fn=setup_child,
                )
            except Exception:
                try:
                    os.close(master_fd)
                except OSError:
                    pass
                try:
                    os.close(slave_fd)
                except OSError:
                    pass
                self.master_fd = None
                self.log.exception(
                    "failed to start command cwd=%s command=%s",
                    self.cwd,
                    shlex.join(self.command),
                )
                raise
            else:
                os.close(slave_fd)

            self.log.info(
                "started command pid=%s cwd=%s command=%s",
                self.proc.pid,
                self.cwd,
                shlex.join(self.command),
            )
            self._append_event_locked("status", self.status_locked())

            reader = threading.Thread(
                target=self._reader_loop,
                args=(self.proc, master_fd),
                daemon=True,
                name="codex-pty-reader",
            )
            reader.start()

    def restart(self) -> None:
        self.start()

    def stop(self) -> None:
        with self._lock:
            if self.proc is not None and self.proc.poll() is None:
                self.log.info("stopping hosted command")
            self._stop_locked()
            self._append_event_locked("status", self.status_locked())

    def write(self, data: bytes) -> bool:
        with self._lock:
            if not data or self.master_fd is None or self.proc is None or self.proc.poll() is not None:
                return False
            self._track_input_locked(data)
            os.write(self.master_fd, data)
            return True

    def resize(self, cols: int, rows: int) -> None:
        cols = max(20, min(cols, 400))
        rows = max(5, min(rows, 160))
        with self._lock:
            if self.cols == cols and self.rows == rows:
                return
            self.cols = cols
            self.rows = rows
            if self.master_fd is not None:
                self._set_winsize(self.master_fd, cols, rows)
            self._append_event_locked("status", self.status_locked())
            self.log.debug("resized terminal to %sx%s", cols, rows)

    def events_after(self, last_id: int, timeout: float = 15.0) -> list[dict[str, Any]]:
        deadline = time.time() + timeout
        with self._cv:
            while True:
                pending = [event for event in self._events if event["id"] > last_id]
                if pending:
                    return pending
                remaining = deadline - time.time()
                if remaining <= 0:
                    return []
                self._cv.wait(timeout=remaining)

    def status(self) -> dict[str, Any]:
        with self._lock:
            return self.status_locked()

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return self.snapshot_locked()

    def indicator_state(self, waiting_transition_s: float = 3.0) -> int:
        with self._lock:
            running = bool(self.proc and self.proc.poll() is None)
            if not running:
                return 0

            if self._active_turn_seq is None:
                return 0
            if self._waiting_turn_seq == self._active_turn_seq:
                return 2
            if self._responded_turn_seq != self._active_turn_seq or self.last_output_at is None:
                return 0
            if (time.time() - self.last_output_at) < waiting_transition_s:
                return 1
            self._waiting_turn_seq = self._active_turn_seq
            return 2

    def status_locked(self) -> dict[str, Any]:
        running = bool(self.proc and self.proc.poll() is None)
        return {
            "running": running,
            "state": "running" if running else "exited",
            "pid": self.proc.pid if self.proc else None,
            "cwd": str(self.cwd),
            "command": self.command,
            "cols": self.cols,
            "rows": self.rows,
            "exit_code": self.exit_code,
            "started_at": self.started_at,
            "last_output_at": self.last_output_at,
            "last_event_id": self._next_event_id - 1,
        }

    def snapshot_locked(self) -> dict[str, Any]:
        transcript = self._read_transcript_locked()
        return {
            "status": self.status_locked(),
            "output_b64": base64.b64encode(transcript).decode("ascii"),
            "output_bytes": len(transcript),
        }

    def _append_event_locked(self, event_type: str, payload: dict[str, Any]) -> None:
        event = {"id": self._next_event_id, "type": event_type, "payload": payload}
        self._next_event_id += 1
        self._events.append(event)
        self._cv.notify_all()

    def _reader_loop(self, proc: subprocess.Popen[bytes], master_fd: int) -> None:
        try:
            while True:
                data = os.read(master_fd, 65536)
                if not data:
                    break
                payload = {"data_b64": base64.b64encode(data).decode("ascii")}
                with self._lock:
                    if self.proc is not proc or self.master_fd != master_fd:
                        return
                    self.last_output_at = time.time()
                    self._track_output_locked()
                    self._transcript.write(data)
                    self._append_event_locked("output", payload)
        except OSError as exc:
            if exc.errno != errno.EIO:
                self.log.debug("pty reader stopped with os error: %s", exc)
        finally:
            exit_code = proc.poll()
            if exit_code is None:
                try:
                    exit_code = proc.wait(timeout=1)
                except subprocess.TimeoutExpired:
                    exit_code = proc.poll()
            with self._lock:
                if self.proc is proc:
                    self.exit_code = exit_code
                    self.proc = proc
                    if self.master_fd is not None:
                        try:
                            os.close(self.master_fd)
                        except OSError:
                            pass
                        self.master_fd = None
                    self._append_event_locked("status", self.status_locked())
                    self.log.info("command exited pid=%s exit_code=%s", proc.pid, exit_code)

    def _stop_locked(self) -> int | None:
        proc = self.proc
        master_fd = self.master_fd
        self.proc = None
        self.master_fd = None
        exit_code = self.exit_code
        if master_fd is not None:
            try:
                os.close(master_fd)
            except OSError:
                pass
        if proc and proc.poll() is None:
            try:
                os.killpg(proc.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                exit_code = proc.wait(timeout=1)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                try:
                    exit_code = proc.wait(timeout=1)
                except subprocess.TimeoutExpired:
                    pass
        elif proc:
            exit_code = proc.poll()
        self.exit_code = exit_code
        if proc is not None and exit_code is not None:
            self.log.debug("command stop cleanup finished pid=%s exit_code=%s", proc.pid, exit_code)
        return exit_code

    def _reset_indicator_tracking_locked(self) -> None:
        self._turn_seq = 0
        self._active_turn_seq = None
        self._responded_turn_seq = None
        self._waiting_turn_seq = None

    def _track_input_locked(self, data: bytes) -> None:
        if b"\r" not in data and b"\n" not in data:
            return
        self._turn_seq += 1
        self._active_turn_seq = self._turn_seq
        self._responded_turn_seq = None
        self._waiting_turn_seq = None
        self.log.debug("indicator armed for submitted turn=%s", self._active_turn_seq)

    def _track_output_locked(self) -> None:
        if self._active_turn_seq is None:
            return
        self._responded_turn_seq = self._active_turn_seq
        if self._waiting_turn_seq == self._active_turn_seq:
            self._waiting_turn_seq = None
            self.log.debug("indicator waiting latch cleared by resumed output turn=%s", self._active_turn_seq)

    def _reset_transcript_locked(self) -> None:
        try:
            self._transcript.close()
        except Exception:
            pass
        self._transcript = tempfile.SpooledTemporaryFile(max_size=1024 * 1024, mode="w+b")

    def _read_transcript_locked(self) -> bytes:
        self._transcript.flush()
        position = self._transcript.tell()
        self._transcript.seek(0)
        data = self._transcript.read()
        self._transcript.seek(position)
        return data

    @staticmethod
    def _set_winsize(fd: int, cols: int, rows: int) -> None:
        winsize = struct.pack("HHHH", rows, cols, 0, 0)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)


class AppServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class AppHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    @property
    def session(self) -> TerminalSession:
        return self.server.session  # type: ignore[attr-defined]

    @property
    def logger(self) -> logging.Logger:
        return self.server.logger  # type: ignore[attr-defined]

    def handle(self) -> None:
        try:
            super().handle()
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            return
        except OSError as exc:
            if exc.errno in {errno.EPIPE, errno.ECONNRESET, errno.ECONNABORTED}:
                return
            raise

    def finish(self) -> None:
        try:
            super().finish()
        except (BrokenPipeError, ConnectionResetError, TimeoutError, ValueError):
            return
        except OSError as exc:
            if exc.errno in {errno.EPIPE, errno.ECONNRESET, errno.ECONNABORTED}:
                return
            raise

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/state":
            self._send_json(self.session.status())
            return
        if parsed.path == "/api/snapshot":
            self._send_json(self.session.snapshot())
            return
        if parsed.path == "/api/events":
            self._handle_sse(parsed)
            return
        file_path = STATIC_FILES.get(parsed.path) or VENDOR_FILES.get(parsed.path)
        if file_path:
            self._send_file(file_path)
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Not found")

    def do_HEAD(self) -> None:
        parsed = urlparse(self.path)
        file_path = STATIC_FILES.get(parsed.path) or VENDOR_FILES.get(parsed.path)
        if not file_path:
            self.send_error(HTTPStatus.NOT_FOUND, "Not found")
            return
        self._send_file(file_path, head_only=True)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/input":
            try:
                payload = self._read_json()
            except ValueError as exc:
                self.send_error(HTTPStatus.BAD_REQUEST, str(exc))
                return
            data_b64 = payload.get("data_b64", "")
            if not isinstance(data_b64, str):
                self.send_error(HTTPStatus.BAD_REQUEST, "data_b64 must be a string")
                return
            try:
                data = base64.b64decode(data_b64)
            except Exception:
                self.send_error(HTTPStatus.BAD_REQUEST, "Invalid base64 payload")
                return
            accepted = self.session.write(data)
            self._send_json({"ok": accepted})
            return
        if parsed.path == "/api/resize":
            try:
                payload = self._read_json()
            except ValueError as exc:
                self.send_error(HTTPStatus.BAD_REQUEST, str(exc))
                return
            try:
                cols = int(payload["cols"])
                rows = int(payload["rows"])
            except (KeyError, TypeError, ValueError):
                self.send_error(HTTPStatus.BAD_REQUEST, "cols and rows are required integers")
                return
            self.session.resize(cols, rows)
            self._send_json({"ok": True})
            return
        if parsed.path == "/api/restart":
            self.session.restart()
            self._send_json({"ok": True, "status": self.session.status()})
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Not found")

    def _send_file(self, path: Path, head_only: bool = False) -> None:
        if not path.exists():
            self.send_error(HTTPStatus.NOT_FOUND, f"Missing file: {path.name}")
            return
        if path.suffix == ".html":
            content_type = "text/html; charset=utf-8"
        elif path.suffix == ".js":
            content_type = "application/javascript; charset=utf-8"
        elif path.suffix == ".css":
            content_type = "text/css; charset=utf-8"
        elif path.suffix == ".json":
            content_type = "application/json; charset=utf-8"
        else:
            content_type = "application/octet-stream"
        payload = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        if not head_only:
            self.wfile.write(payload)

    def _send_json(self, payload: dict[str, Any], status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length) if length else b"{}"
        try:
            return json.loads(body.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError("Invalid JSON payload") from exc

    def _handle_sse(self, parsed) -> None:  # type: ignore[no-untyped-def]
        query = parse_qs(parsed.query)
        try:
            last_id = int(self.headers.get("Last-Event-ID") or query.get("last_id", ["0"])[0])
        except ValueError:
            last_id = 0

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        self.wfile.write(b": connected\n\n")
        self.wfile.flush()

        try:
            while True:
                events = self.session.events_after(last_id, timeout=15.0)
                if not events:
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
                    continue
                for event in events:
                    body = json.dumps(event["payload"], separators=(",", ":"))
                    frame = f"id: {event['id']}\nevent: {event['type']}\ndata: {body}\n\n"
                    self.wfile.write(frame.encode("utf-8"))
                    last_id = event["id"]
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            return

    def log_request(self, code: int | str = "-", size: int | str = "-") -> None:
        path = urlparse(self.path).path
        try:
            numeric_code = int(code)
        except (TypeError, ValueError):
            numeric_code = None

        if numeric_code is not None and numeric_code < 400 and path in SUPPRESSED_HTTP_SUCCESS_PATHS:
            return

        level = logging.INFO
        if numeric_code is not None and numeric_code >= 400:
            level = logging.WARNING
        elif path in QUIET_HTTP_PATHS:
            level = logging.DEBUG

        self.logger.log(
            level,
            '%s "%s %s" %s %s',
            self.address_string(),
            self.command,
            self.path,
            code,
            size,
        )

    def log_message(self, fmt: str, *args: Any) -> None:
        self.logger.debug(fmt, *args)

    def log_error(self, fmt: str, *args: Any) -> None:
        self.logger.warning(fmt, *args)


def guess_lan_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            return sock.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def configure_logging(level_name: str) -> logging.Logger:
    level = getattr(logging, level_name.upper(), logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname).1s %(name)s | %(message)s",
        datefmt="%H:%M:%S",
    )
    return logging.getLogger("codex")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Expose Codex CLI over a LAN-accessible HTTP terminal")
    parser.add_argument("--host", default="0.0.0.0", help="Bind host, default: 0.0.0.0")
    parser.add_argument("--port", type=int, default=8080, help="Bind port, default: 8080")
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=("DEBUG", "INFO", "WARNING", "ERROR"),
        help="Logging verbosity, default: INFO",
    )
    parser.add_argument(
        "--ble-indicator",
        action="store_true",
        help="Reuse a system-connected Pico2W BLE indicator and mirror Codex activity",
    )
    parser.add_argument(
        "--ble-device-name",
        default="codex-pico-ble",
        help="BLE device name for the Pico2W indicator, default: codex-pico-ble",
    )
    parser.add_argument(
        "--ble-device-address",
        default=None,
        help="Optional BLE address to match against the system-connected indicator",
    )
    parser.add_argument(
        "--ble-output-active-ms",
        type=int,
        default=3000,
        help="How long Codex must stay quiet after a submitted turn before completion flash starts, default: 3000",
    )
    parser.add_argument(
        "--ble-heartbeat-ms",
        type=int,
        default=1000,
        help="Heartbeat write interval for the BLE indicator, default: 1000",
    )
    parser.add_argument(
        "--ble-write-failure-threshold",
        type=int,
        default=3,
        help="Reconnect BLE after this many consecutive write failures, default: 3",
    )
    parser.add_argument(
        "--cwd",
        default=os.getcwd(),
        help="Working directory for the hosted Codex session, default: current directory",
    )
    parser.add_argument(
        "command",
        nargs=argparse.REMAINDER,
        help="Command to host after `--`, default: codex",
    )
    args = parser.parse_args()
    args.command = args.command or ["codex"]
    if args.command and args.command[0] == "--":
        args.command = args.command[1:]
    return args


def main() -> None:
    args = parse_args()
    logger = configure_logging(args.log_level)

    missing = [path for path in VENDOR_FILES.values() if not path.exists()]
    if missing:
        missing_list = ", ".join(str(path.relative_to(ROOT)) for path in missing)
        raise SystemExit(f"Missing frontend assets: {missing_list}. Run `npm install` first.")

    session = TerminalSession(
        command=args.command,
        cwd=Path(args.cwd).resolve(),
        logger=logger.getChild("session"),
    )
    session.start()

    indicator = None
    if args.ble_indicator:
        from ble_indicator import (
            BleIndicatorBridge,
            BleIndicatorDependencyError,
            BleIndicatorUnavailableError,
        )

        try:
            indicator = BleIndicatorBridge(
                session,
                device_name=args.ble_device_name,
                device_address=args.ble_device_address,
                waiting_transition_s=max(args.ble_output_active_ms, 300) / 1000.0,
                heartbeat_s=max(args.ble_heartbeat_ms, 200) / 1000.0,
                write_failure_threshold=max(args.ble_write_failure_threshold, 1),
                logger=logger.getChild("ble"),
            )
            indicator.start()
        except (BleIndicatorDependencyError, BleIndicatorUnavailableError) as exc:
            logger.warning("ble indicator disabled: %s", exc)
            indicator = None
        except Exception:
            logger.exception("ble indicator initialization failed; continuing without ble")
            indicator = None

    server = AppServer((args.host, args.port), AppHandler)
    server.session = session  # type: ignore[attr-defined]
    server.logger = logger.getChild("http")  # type: ignore[attr-defined]

    lan_ip = guess_lan_ip()
    logger.info("serving local url http://127.0.0.1:%s", args.port)
    logger.info("serving lan url http://%s:%s", lan_ip, args.port)
    logger.info("workspace %s", session.cwd)
    logger.info("hosted command %s", shlex.join(args.command))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("shutdown requested by keyboard interrupt")
    finally:
        if indicator is not None:
            indicator.stop()
        session.stop()
        server.server_close()
        logger.info("server stopped")


if __name__ == "__main__":
    main()
