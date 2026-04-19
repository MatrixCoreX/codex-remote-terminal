#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${BUILD_DIR:-${ROOT_DIR}/build-codex-pico-ble-indicator}"
SDK_PATH="${PICO_SDK_PATH:-${ROOT_DIR}/.deps/pico-sdk}"
PICOTOOL_CACHE="${PICOTOOL_FETCH_FROM_GIT_PATH:-${ROOT_DIR}/build/_deps}"
JOBS="${JOBS:-$(nproc)}"

cmake -S "${ROOT_DIR}" -B "${BUILD_DIR}" \
  -DPICO_SDK_PATH="${SDK_PATH}" \
  -DPICOTOOL_FETCH_FROM_GIT_PATH="${PICOTOOL_CACHE}" \
  -DPICO_BOARD=pico2_w

cmake --build "${BUILD_DIR}" --target codex_pico_ble_indicator -j"${JOBS}"

echo "Build complete:"
echo "  ${BUILD_DIR}/codex_pico_ble_indicator.uf2"
echo "  ${BUILD_DIR}/codex_pico_ble_indicator.bin"
