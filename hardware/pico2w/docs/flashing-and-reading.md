# Flashing and Reading

## English

This document is for `Codex Pico BLE Indicator`.

It covers two tasks:

- flashing the firmware
- reading serial logs for startup, pairing, and state changes

### Install Dependencies

Install system packages first:

```bash
sudo apt update
sudo apt install -y cmake gcc-arm-none-eabi libnewlib-arm-none-eabi build-essential git picocom
```

If the repo does not already contain a local `pico-sdk` checkout:

```bash
cd /path/to/this-repo/hardware/pico2w
git clone https://github.com/raspberrypi/pico-sdk.git .deps/pico-sdk
git -C .deps/pico-sdk submodule update --init
```

## Path 1: Manual Commands

### Build Manually

```bash
cd /path/to/this-repo/hardware/pico2w
cmake -S . -B build-codex-pico-ble-indicator \
  -DPICO_SDK_PATH=/path/to/this-repo/hardware/pico2w/.deps/pico-sdk \
  -DPICOTOOL_FETCH_FROM_GIT_PATH=/path/to/this-repo/hardware/pico2w/build/_deps \
  -DPICO_BOARD=pico2_w
cmake --build build-codex-pico-ble-indicator -j"$(nproc)"
```

Artifacts:

- `build-codex-pico-ble-indicator/codex_pico_ble_indicator.uf2`
- `build-codex-pico-ble-indicator/codex_pico_ble_indicator.bin`

### Flash Manually

To enter flashing mode:

1. Unplug USB.
2. Hold `BOOTSEL`.
3. Plug USB back in.
4. Release `BOOTSEL` after the `RP2350` drive appears.

Confirm the boot drive is mounted:

```bash
ls /media/$USER/RP2350
```

Confirm the firmware file exists:

```bash
ls -l /path/to/this-repo/hardware/pico2w/build-codex-pico-ble-indicator/codex_pico_ble_indicator.uf2
```

Copy the firmware:

```bash
cp /path/to/this-repo/hardware/pico2w/build-codex-pico-ble-indicator/codex_pico_ble_indicator.uf2 /media/$USER/RP2350/
```

After the copy finishes, the board reboots automatically and the `RP2350` drive disappears. That is normal.

### Read Serial Logs Manually

Find the serial device:

```bash
ls -l /dev/ttyACM* /dev/serial/by-id 2>/dev/null
```

Open the default device:

```bash
picocom -b 115200 /dev/ttyACM0
```

Or use the more stable `by-id` path:

```bash
ls -l /dev/serial/by-id
picocom -b 115200 /dev/serial/by-id/<your-pico-entry>
```

Typical startup output:

```text
Boot: Codex Pico BLE indicator starting
Wi-Fi/Bluetooth stack init complete
BLE indicator advertising as codex-pico-ble
```

Other runtime logs include:

- BLE pairing started / completed
- BLE disconnected
- BLE state changed
- BLE bonds cleared

Exit `picocom`:

```text
Ctrl-A Ctrl-X
```

## Path 2: Repository Scripts

### Build with the Helper Script

```bash
cd /path/to/this-repo/hardware/pico2w
./scripts/build-codex-pico-ble-indicator.sh
```

### Flash with the Helper Script

```bash
cd /path/to/this-repo/hardware/pico2w
./scripts/flash-codex-pico-ble-indicator.sh
```

The script will:

- try to toggle `ttyACM0` at `1200 baud` so the Pico re-enters `BOOTSEL`
- wait for the `RP2350` drive
- copy `codex_pico_ble_indicator.uf2` automatically

If you want it to build first:

```bash
cd /path/to/this-repo/hardware/pico2w
./scripts/flash-codex-pico-ble-indicator.sh --build
```

If automatic `BOOTSEL` entry fails, hold `BOOTSEL` manually while plugging USB, then run:

```bash
cd /path/to/this-repo/hardware/pico2w
./scripts/flash-codex-pico-ble-indicator.sh --wait-only
```

## Fix Serial Permission Problems

On Ubuntu, serial devices usually belong to the `dialout` group.

If `picocom` reports `Permission denied`, run:

```bash
sudo usermod -aG dialout $USER
newgrp dialout
```

If it still does not apply after `newgrp`, log out and log back in once.

## Notes

- This firmware is only a BLE indicator. It does not expose a web page or HID input controls.
- A short `BOOTSEL` press restarts BLE advertising.
- A long `BOOTSEL` press, about `1.8 s`, clears stored BLE bonds and restarts advertising.

## 中文

这份文档适用于 `Codex Pico BLE Indicator`。

它只讲两件事：

- 如何烧录固件
- 如何读取启动、配对和状态切换相关的串口日志

### 安装依赖

先安装系统包：

```bash
sudo apt update
sudo apt install -y cmake gcc-arm-none-eabi libnewlib-arm-none-eabi build-essential git picocom
```

如果仓库里还没有本地 `pico-sdk`：

```bash
cd /path/to/this-repo/hardware/pico2w
git clone https://github.com/raspberrypi/pico-sdk.git .deps/pico-sdk
git -C .deps/pico-sdk submodule update --init
```

## 方式一：手动命令

### 手动构建

```bash
cd /path/to/this-repo/hardware/pico2w
cmake -S . -B build-codex-pico-ble-indicator \
  -DPICO_SDK_PATH=/path/to/this-repo/hardware/pico2w/.deps/pico-sdk \
  -DPICOTOOL_FETCH_FROM_GIT_PATH=/path/to/this-repo/hardware/pico2w/build/_deps \
  -DPICO_BOARD=pico2_w
cmake --build build-codex-pico-ble-indicator -j"$(nproc)"
```

产物：

- `build-codex-pico-ble-indicator/codex_pico_ble_indicator.uf2`
- `build-codex-pico-ble-indicator/codex_pico_ble_indicator.bin`

### 手动烧录

进入刷机模式的步骤：

1. 拔掉 USB
2. 按住 `BOOTSEL`
3. 重新插上 USB
4. 等 `RP2350` 盘出现后松开 `BOOTSEL`

先确认启动盘已经挂载：

```bash
ls /media/$USER/RP2350
```

再确认固件文件存在：

```bash
ls -l /path/to/this-repo/hardware/pico2w/build-codex-pico-ble-indicator/codex_pico_ble_indicator.uf2
```

把固件拷进去：

```bash
cp /path/to/this-repo/hardware/pico2w/build-codex-pico-ble-indicator/codex_pico_ble_indicator.uf2 /media/$USER/RP2350/
```

拷贝完成后，板子会自动重启，`RP2350` 盘会消失，这是正常现象。

### 手动读取串口日志

先找串口设备：

```bash
ls -l /dev/ttyACM* /dev/serial/by-id 2>/dev/null
```

打开默认串口：

```bash
picocom -b 115200 /dev/ttyACM0
```

或者使用更稳定的 `by-id` 路径：

```bash
ls -l /dev/serial/by-id
picocom -b 115200 /dev/serial/by-id/<your-pico-entry>
```

典型启动输出：

```text
Boot: Codex Pico BLE indicator starting
Wi-Fi/Bluetooth stack init complete
BLE indicator advertising as codex-pico-ble
```

其他运行期日志包括：

- BLE pairing started / completed
- BLE disconnected
- BLE state changed
- BLE bonds cleared

退出 `picocom`：

```text
Ctrl-A Ctrl-X
```

## 方式二：仓库脚本

### 用辅助脚本构建

```bash
cd /path/to/this-repo/hardware/pico2w
./scripts/build-codex-pico-ble-indicator.sh
```

### 用辅助脚本烧录

```bash
cd /path/to/this-repo/hardware/pico2w
./scripts/flash-codex-pico-ble-indicator.sh
```

这个脚本会：

- 尝试把 `ttyACM0` 切到 `1200 baud`，让 Pico 重新进入 `BOOTSEL`
- 等待 `RP2350` 盘出现
- 自动拷贝 `codex_pico_ble_indicator.uf2`

如果你想先构建再烧录：

```bash
cd /path/to/this-repo/hardware/pico2w
./scripts/flash-codex-pico-ble-indicator.sh --build
```

如果自动进入 `BOOTSEL` 失败，先手动按住 `BOOTSEL` 插 USB，再执行：

```bash
cd /path/to/this-repo/hardware/pico2w
./scripts/flash-codex-pico-ble-indicator.sh --wait-only
```

## 解决串口权限问题

在 Ubuntu 上，串口设备通常属于 `dialout` 组。

如果 `picocom` 报 `Permission denied`，执行：

```bash
sudo usermod -aG dialout $USER
newgrp dialout
```

如果 `newgrp` 后还不生效，就注销并重新登录一次。

## 说明

- 这套固件只是 BLE 指示灯，不提供网页，也不提供 HID 键盘鼠标控制。
- 短按 `BOOTSEL` 会重启 BLE 广播。
- 长按 `BOOTSEL` 约 `1.8 s` 会清空已保存的 BLE 配对信息，并重启广播。
