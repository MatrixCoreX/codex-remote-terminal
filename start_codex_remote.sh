#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_BIN="${SCRIPT_DIR}/.venv/bin/python"

HOST="${CODEX_REMOTE_HOST:-0.0.0.0}"
PORT="${CODEX_REMOTE_PORT:-8080}"
WORKDIR="${CODEX_REMOTE_CWD:-$PWD}"
LOG_LEVEL="${CODEX_REMOTE_LOG_LEVEL:-INFO}"
BLE_ENABLED="${CODEX_REMOTE_BLE:-1}"
BLE_DEVICE_NAME="${CODEX_REMOTE_BLE_DEVICE_NAME:-codex-pico-ble}"
BLE_DEVICE_ADDRESS="${CODEX_REMOTE_BLE_DEVICE_ADDRESS:-}"
BLE_OUTPUT_ACTIVE_MS="${CODEX_REMOTE_BLE_OUTPUT_ACTIVE_MS:-1600}"
BLE_HEARTBEAT_MS="${CODEX_REMOTE_BLE_HEARTBEAT_MS:-1000}"
BLE_WRITE_FAILURE_THRESHOLD="${CODEX_REMOTE_BLE_WRITE_FAILURE_THRESHOLD:-3}"
SEARCH_ENABLED="${CODEX_REMOTE_SEARCH:-1}"
CODEX_BIN="${CODEX_REMOTE_CODEX_BIN:-codex}"

usage() {
  cat <<'EOF'
Usage:
  ./start_codex_remote.sh [options] [-- codex_args...]

Options:
  --cwd DIR                  Codex working directory, default: current directory
  --host HOST                HTTP bind host
  --port PORT                HTTP bind port
  --log-level LEVEL          DEBUG/INFO/WARNING/ERROR
  --ble                      Enable BLE indicator
  --no-ble                   Disable BLE indicator
  --ble-device-name NAME     Match system BLE device by name
  --ble-device-address ADDR  Match system BLE device by address
  --search                   Enable Codex live web search (default)
  --no-search                Disable Codex live web search
  --codex-bin PATH           Codex executable, default: codex
  -h, --help                 Show this help

Environment overrides:
  CODEX_REMOTE_CWD
  CODEX_REMOTE_HOST
  CODEX_REMOTE_PORT
  CODEX_REMOTE_LOG_LEVEL
  CODEX_REMOTE_BLE=1|0
  CODEX_REMOTE_BLE_DEVICE_NAME
  CODEX_REMOTE_BLE_DEVICE_ADDRESS
  CODEX_REMOTE_SEARCH=1|0
  CODEX_REMOTE_CODEX_BIN
EOF
}

CODEx_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cwd)
      WORKDIR="${2:?missing value for --cwd}"
      shift 2
      ;;
    --host)
      HOST="${2:?missing value for --host}"
      shift 2
      ;;
    --port)
      PORT="${2:?missing value for --port}"
      shift 2
      ;;
    --log-level)
      LOG_LEVEL="${2:?missing value for --log-level}"
      shift 2
      ;;
    --ble)
      BLE_ENABLED=1
      shift
      ;;
    --no-ble)
      BLE_ENABLED=0
      shift
      ;;
    --ble-device-name)
      BLE_DEVICE_NAME="${2:?missing value for --ble-device-name}"
      shift 2
      ;;
    --ble-device-address)
      BLE_DEVICE_ADDRESS="${2:?missing value for --ble-device-address}"
      shift 2
      ;;
    --search)
      SEARCH_ENABLED=1
      shift
      ;;
    --no-search)
      SEARCH_ENABLED=0
      shift
      ;;
    --codex-bin)
      CODEX_BIN="${2:?missing value for --codex-bin}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --)
      shift
      CODEx_ARGS=("$@")
      break
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ ! -x "${PYTHON_BIN}" ]]; then
  echo "Missing virtualenv python: ${PYTHON_BIN}" >&2
  echo "Create it first or install dependencies into .venv." >&2
  exit 1
fi

if [[ ! -d "${WORKDIR}" ]]; then
  echo "Working directory does not exist: ${WORKDIR}" >&2
  exit 1
fi

if ! command -v "${CODEX_BIN}" >/dev/null 2>&1; then
  echo "Codex executable not found in PATH: ${CODEX_BIN}" >&2
  exit 1
fi

PYTHON_ARGS=(
  "${SCRIPT_DIR}/codex_remote_http.py"
  --host "${HOST}"
  --port "${PORT}"
  --log-level "${LOG_LEVEL}"
  --cwd "${WORKDIR}"
)

if [[ "${BLE_ENABLED}" != "0" ]]; then
  PYTHON_ARGS+=(
    --ble-indicator
    --ble-device-name "${BLE_DEVICE_NAME}"
    --ble-output-active-ms "${BLE_OUTPUT_ACTIVE_MS}"
    --ble-heartbeat-ms "${BLE_HEARTBEAT_MS}"
    --ble-write-failure-threshold "${BLE_WRITE_FAILURE_THRESHOLD}"
  )
  if [[ -n "${BLE_DEVICE_ADDRESS}" ]]; then
    PYTHON_ARGS+=(--ble-device-address "${BLE_DEVICE_ADDRESS}")
  fi
fi

if [[ ${#CODEx_ARGS[@]} -eq 0 ]]; then
  CODEx_ARGS=("${CODEX_BIN}")
else
  CODEx_ARGS=("${CODEX_BIN}" "${CODEx_ARGS[@]}")
fi

if [[ "${SEARCH_ENABLED}" != "0" ]]; then
  HAS_SEARCH_FLAG=0
  for arg in "${CODEx_ARGS[@]:1}"; do
    if [[ "${arg}" == "--search" ]]; then
      HAS_SEARCH_FLAG=1
      break
    fi
  done
  if [[ "${HAS_SEARCH_FLAG}" == "0" ]]; then
    CODEx_ARGS=("${CODEx_ARGS[0]}" "--search" "${CODEx_ARGS[@]:1}")
  fi
fi

echo "Starting Codex Remote"
echo "  host: ${HOST}"
echo "  port: ${PORT}"
echo "  cwd:  ${WORKDIR}"
echo "  ble:  $([[ "${BLE_ENABLED}" != "0" ]] && echo on || echo off)"
echo "  web:  $([[ "${SEARCH_ENABLED}" != "0" ]] && echo on || echo off)"
echo "  cmd:  ${CODEx_ARGS[*]}"

exec "${PYTHON_BIN}" "${PYTHON_ARGS[@]}" -- "${CODEx_ARGS[@]}"
