from __future__ import annotations

import asyncio
import logging
from pathlib import Path
import threading
import time
from typing import Any

try:
    from bleak import BleakClient
    from bleak.backends.device import BLEDevice
    from bleak.exc import BleakDBusError, BleakGATTProtocolError, BleakGATTProtocolErrorCode
except ImportError as exc:  # pragma: no cover - optional dependency
    BleakClient = None  # type: ignore[assignment]
    BLEDevice = None  # type: ignore[assignment]
    BleakDBusError = None  # type: ignore[assignment]
    BleakGATTProtocolError = None  # type: ignore[assignment]
    BleakGATTProtocolErrorCode = None  # type: ignore[assignment]
    _BLEAK_IMPORT_ERROR = exc
else:
    _BLEAK_IMPORT_ERROR = None

try:
    from bleak.backends.bluezdbus import defs as bluez_defs
    from bleak.backends.bluezdbus.manager import get_global_bluez_manager
except ImportError:  # pragma: no cover - backend/platform dependent
    bluez_defs = None  # type: ignore[assignment]
    get_global_bluez_manager = None  # type: ignore[assignment]


class BleIndicatorDependencyError(RuntimeError):
    pass


class BleIndicatorReconnectError(RuntimeError):
    pass


class BleIndicatorUnavailableError(RuntimeError):
    pass


class BleIndicatorBridge:
    STATE_OFF = 0
    STATE_OUTPUTTING = 1
    STATE_WAITING = 2

    SERVICE_UUID = "0000CD10-0000-1000-8000-00805F9B34FB"
    CHARACTERISTIC_UUID = "0000CD11-0000-1000-8000-00805F9B34FB"
    BLUETOOTH_SYSFS_DIR = Path("/sys/class/bluetooth")

    def __init__(
        self,
        session: Any,
        *,
        device_name: str = "codex-pico-ble",
        device_address: str | None = None,
        characteristic_uuid: str = CHARACTERISTIC_UUID,
        waiting_transition_s: float = 3.0,
        heartbeat_s: float = 1.0,
        scan_timeout_s: float = 5.0,
        reconnect_s: float = 3.0,
        write_failure_threshold: int = 3,
        logger: logging.Logger | None = None,
    ) -> None:
        self.session = session
        self.device_name = device_name
        self.device_address = device_address
        self.characteristic_uuid = characteristic_uuid
        self.waiting_transition_s = waiting_transition_s
        self.heartbeat_s = heartbeat_s
        self.scan_timeout_s = scan_timeout_s
        self.reconnect_s = reconnect_s
        self.write_failure_threshold = max(1, int(write_failure_threshold))
        self.log = logger or logging.getLogger("codex.ble")
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._last_missing_log_at = 0.0
        self._last_missing_message: str | None = None
        self._last_failure_log_at = 0.0
        self._last_failure_message: str | None = None

    def start(self) -> None:
        if BleakClient is None:
            raise BleIndicatorDependencyError(
                "BLE indicator requires `bleak`. Install it with `pip install -r requirements-ble.txt`."
            )
        if get_global_bluez_manager is None or bluez_defs is None:
            raise BleIndicatorDependencyError("BLE indicator requires the BlueZ backend on Linux.")
        if self._thread is not None:
            return
        self._preflight_environment_check()
        self._thread = threading.Thread(target=self._thread_main, daemon=True, name="ble-indicator")
        self._thread.start()
        self.log.info(
            "ble indicator bridge started target=%s",
            self.device_address or self.device_name,
        )

    def stop(self, timeout: float = 5.0) -> None:
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=timeout)
        self.log.info("ble indicator bridge stopped")

    def _thread_main(self) -> None:
        try:
            asyncio.run(self._run())
        except Exception:
            self.log.exception("ble worker crashed")

    def _desired_state(self) -> int:
        return int(self.session.indicator_state(self.waiting_transition_s))

    def _should_stop(self) -> bool:
        return self._stop_event.is_set()

    def _log_failure(self, message: str) -> None:
        now = time.monotonic()
        if message != self._last_failure_message or (now - self._last_failure_log_at) >= 15.0:
            self._last_failure_message = message
            self._last_failure_log_at = now
            self.log.warning(message)
        else:
            self.log.debug(message)

    def _log_missing_target(self, message: str) -> None:
        now = time.monotonic()
        if message != self._last_missing_message or (now - self._last_missing_log_at) >= 15.0:
            self._last_missing_message = message
            self._last_missing_log_at = now
            self.log.info(message)
        else:
            self.log.debug(message)

    @classmethod
    def _has_sysfs_bluetooth_adapter(cls) -> bool:
        if not cls.BLUETOOTH_SYSFS_DIR.exists():
            return False
        try:
            return any(path.name.startswith("hci") for path in cls.BLUETOOTH_SYSFS_DIR.iterdir())
        except OSError:
            return True

    async def _has_bluez_adapter(self) -> bool:
        if get_global_bluez_manager is None or bluez_defs is None:
            return False

        try:
            manager = await get_global_bluez_manager()
        except Exception:
            return False

        adapter_interface = getattr(bluez_defs, "ADAPTER_INTERFACE", None)
        if not adapter_interface:
            return True

        try:
            return any(props.get(adapter_interface) for props in manager._properties.values())
        except Exception:
            return True

    def _preflight_environment_check(self) -> None:
        if not self._has_sysfs_bluetooth_adapter():
            raise BleIndicatorUnavailableError("no system bluetooth adapter detected")

        try:
            previous_loop = asyncio.get_event_loop()
        except RuntimeError:
            previous_loop = None
        loop = asyncio.new_event_loop()
        try:
            asyncio.set_event_loop(loop)
            has_adapter = loop.run_until_complete(self._has_bluez_adapter())
        finally:
            asyncio.set_event_loop(previous_loop)
            loop.close()

        if not has_adapter:
            raise BleIndicatorUnavailableError("system bluetooth is unavailable")

    async def _get_system_target_info(self) -> dict[str, Any] | None:
        if BLEDevice is None or get_global_bluez_manager is None or bluez_defs is None:
            return None

        try:
            manager = await get_global_bluez_manager()
        except Exception:
            return None

        for path, props in manager._properties.items():
            device = props.get(bluez_defs.DEVICE_INTERFACE)
            if not device:
                continue

            address = device.get("Address")
            alias = device.get("Alias")
            name = device.get("Name")

            if self.device_address:
                matched = address == self.device_address
            else:
                matched = (alias or "") == self.device_name or (name or "") == self.device_name

            if matched:
                display_name = alias or name or address
                return {
                    "path": path,
                    "address": address,
                    "name": display_name,
                    "connected": bool(device.get("Connected")),
                    "device": BLEDevice(
                        address,
                        display_name,
                        {"path": path, "props": device},
                    ),
                }

        return None

    async def _discover_target_from_system(self) -> Any | None:
        info = await self._get_system_target_info()
        if info is None:
            return None
        if not info["connected"]:
            return None
        self.log.debug(
            "reusing system-connected ble device %s (%s)",
            info["name"],
            info["address"],
        )
        return info["device"]

    def _is_in_progress_error(self, exc: Exception) -> bool:
        in_progress_name = getattr(bluez_defs, "BLUEZ_ERROR_IN_PROGRESS", None)
        if BleakDBusError is not None and isinstance(exc, BleakDBusError) and in_progress_name:
            return exc.dbus_error == in_progress_name
        text = str(exc)
        return "org.bluez.Error.InProgress" in text or "In Progress" in text

    def _is_unlikely_error(self, exc: Exception) -> bool:
        if (
            BleakGATTProtocolError is not None
            and BleakGATTProtocolErrorCode is not None
            and isinstance(exc, BleakGATTProtocolError)
        ):
            return exc.code == BleakGATTProtocolErrorCode.UNLIKELY_ERROR
        return "Unlikely Error" in str(exc)

    async def _write_state_once(self, client: Any, payload: bytes) -> None:
        await client.write_gatt_char(self.characteristic_uuid, payload, response=False)

    async def _write_state(self, client: Any, state: int, consecutive_failures: int) -> int:
        payload = bytes([state])
        try:
            await self._write_state_once(client, payload)
            return 0
        except Exception as exc:
            last_exc = exc
            if self._is_unlikely_error(exc):
                self.log.debug("retrying state write after unlikely error")
                await asyncio.sleep(0.15)
                try:
                    await self._write_state_once(client, payload)
                    return 0
                except Exception as retry_exc:
                    last_exc = retry_exc

            next_failures = consecutive_failures + 1
            if next_failures >= self.write_failure_threshold:
                raise BleIndicatorReconnectError(
                    f"write failed {next_failures} times in a row: {last_exc}"
                ) from last_exc

            self.log.debug(
                "transient write failure %s/%s: %s",
                next_failures,
                self.write_failure_threshold,
                last_exc,
            )
            return next_failures

    async def _discover_target(self) -> Any | None:
        target_label = self.device_address or self.device_name
        known_target = await self._discover_target_from_system()
        if known_target is not None:
            self._last_missing_message = None
            return known_target

        info = await self._get_system_target_info()
        if info is None:
            self._log_missing_target(
                f"system device {target_label!r} not found, waiting for system bluetooth"
            )
            return None

        self._log_missing_target(
            f"system device {target_label!r} is not connected, waiting for system bluetooth"
        )
        return None

    async def _release_client(self, client: Any) -> None:
        backend = getattr(client, "_backend", None)
        if backend is None:
            return

        disconnect_monitor_event = getattr(backend, "_disconnect_monitor_event", None)
        if disconnect_monitor_event is not None:
            try:
                disconnect_monitor_event.set()
            except Exception:
                pass
            try:
                backend._disconnect_monitor_event = None
            except Exception:
                pass

        cleanup = getattr(backend, "_cleanup_all", None)
        if callable(cleanup):
            try:
                cleanup()
            except Exception as exc:
                self.log.debug("local bleak cleanup failed: %s", exc)

        bus = getattr(backend, "_bus", None)
        if bus is not None:
            try:
                bus.disconnect()
            except Exception as exc:
                self.log.debug("local dbus disconnect failed: %s", exc)
            try:
                await bus.wait_for_disconnect()
            except Exception as exc:
                self.log.debug("local dbus wait_for_disconnect failed: %s", exc)
            try:
                backend._bus = None
            except Exception:
                pass

        try:
            backend._is_connected = False
        except Exception:
            pass

    async def _run(self) -> None:
        while not self._should_stop():
            target = await self._discover_target()
            if target is None:
                await asyncio.sleep(self.reconnect_s)
                continue

            client = BleakClient(target)
            attached = False
            try:
                await client.connect()
                attached = True
                self.log.info("attached to system ble device %s", self.device_address or self.device_name)
                last_state: int | None = None
                last_write_at = 0.0
                consecutive_write_failures = 0
                await asyncio.sleep(0.15)

                while not self._should_stop() and client.is_connected:
                    state = self._desired_state()
                    now = time.monotonic()
                    if last_state != state or (now - last_write_at) >= self.heartbeat_s:
                        consecutive_write_failures = await self._write_state(
                            client,
                            state,
                            consecutive_write_failures,
                        )
                        if consecutive_write_failures == 0:
                            last_state = state
                            last_write_at = now
                    await asyncio.sleep(min(0.4, self.heartbeat_s / 2))

                if client.is_connected:
                    try:
                        await self._write_state(client, self.STATE_OFF, 0)
                    except Exception:
                        pass
            except Exception as exc:  # pragma: no cover - hardware dependent
                if isinstance(exc, BleIndicatorReconnectError):
                    self.log.warning("%s; retrying against system-managed connection", exc)
                    await asyncio.sleep(1.0)
                    continue
                if self._is_in_progress_error(exc):
                    self._log_failure("system bluetooth is still transitioning, waiting to reuse connection")
                    await asyncio.sleep(self.reconnect_s)
                    continue
                self._log_failure(f"connection/write failed: {exc}")
                await asyncio.sleep(self.reconnect_s)
            finally:
                await self._release_client(client)
                if attached:
                    self.log.info("released local handle for system ble device")
