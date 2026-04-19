#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${BUILD_DIR:-${ROOT_DIR}/build-codex-pico-ble-indicator}"
UF2_PATH="${UF2_PATH:-${BUILD_DIR}/codex_pico_ble_indicator.uf2}"
MOUNT_POINT="${MOUNT_POINT:-/media/${USER}/RP2350}"
SERIAL_PORT="${SERIAL_PORT:-/dev/ttyACM0}"
BOOTSEL_TIMEOUT_SEC="${BOOTSEL_TIMEOUT_SEC:-12}"

usage() {
  cat <<EOF
Usage:
  $(basename "$0") [--build] [--wait-only]

Options:
  --build      Build the firmware before flashing.
  --wait-only  Do not try 1200-baud reset; only wait for manual BOOTSEL.

Environment:
  BUILD_DIR            Build output directory.
  UF2_PATH             UF2 path to flash.
  SERIAL_PORT          CDC serial port used for 1200-baud reset.
  MOUNT_POINT          RP2350 mount point.
  BOOTSEL_TIMEOUT_SEC  Seconds to wait for RP2350 mount.
EOF
}

want_build=0
wait_only=0

while (($#)); do
  case "$1" in
    --build)
      want_build=1
      ;;
    --wait-only)
      wait_only=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

if ((want_build)); then
  "${ROOT_DIR}/scripts/build-codex-pico-ble-indicator.sh"
fi

if [[ ! -f "${UF2_PATH}" ]]; then
  echo "UF2 not found: ${UF2_PATH}" >&2
  echo "Run scripts/build-codex-pico-ble-indicator.sh first, or use --build." >&2
  exit 1
fi

wait_for_mount() {
  local elapsed=0
  while ((elapsed < BOOTSEL_TIMEOUT_SEC)); do
    if [[ -d "${MOUNT_POINT}" ]]; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  return 1
}

try_1200_reset() {
  if [[ ! -e "${SERIAL_PORT}" ]]; then
    return 1
  fi

  echo "Trying 1200-baud reset on ${SERIAL_PORT}..."
  if stty -F "${SERIAL_PORT}" 1200 >/dev/null 2>&1; then
    sleep 1
    return 0
  fi

  echo "1200-baud reset failed on ${SERIAL_PORT}." >&2
  return 1
}

if [[ -d "${MOUNT_POINT}" ]]; then
  echo "Found ${MOUNT_POINT}."
else
  if ((wait_only == 0)); then
    try_1200_reset || true
  fi

  if ! wait_for_mount; then
    cat >&2 <<EOF
RP2350 mount point did not appear: ${MOUNT_POINT}

Enter BOOTSEL manually:
1. Unplug USB.
2. Hold BOOTSEL.
3. Plug USB back in.
4. Release BOOTSEL after ${MOUNT_POINT} appears.

Then run:
  $(basename "$0") --wait-only
EOF
    exit 1
  fi
fi

echo "Flashing ${UF2_PATH} -> ${MOUNT_POINT}/"
cp "${UF2_PATH}" "${MOUNT_POINT}/"
sync
echo "Flash complete. The board should reboot automatically."
