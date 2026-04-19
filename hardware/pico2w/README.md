# Codex Pico BLE Indicator

## English

This directory now contains only the firmware for the `Codex Pico BLE Indicator`.

It is a small BLE peripheral for a Pico 2 W that acts as a physical status light for the desktop-side Codex bridge:

- BLE device name: `codex-pico-ble`
- receives state updates from the Python bridge
- shows whether Codex is actively outputting or waiting for the next input
- does not expose a keyboard, mouse, or web UI
- does not carry terminal content or user input

### Directory Layout

```text
.
├── CMakeLists.txt
├── README.md
├── docs
│   └── flashing-and-reading.md
├── scripts
│   ├── build-codex-pico-ble-indicator.sh
│   └── flash-codex-pico-ble-indicator.sh
└── src
    ├── btstack_config.h
    ├── codex_pico_ble_indicator.c
    ├── codex_pico_ble_indicator.gatt
    └── tusb_config.h
```

### Dependencies

```bash
sudo apt update
sudo apt install -y cmake gcc-arm-none-eabi libnewlib-arm-none-eabi build-essential git
```

This repo expects a local Pico SDK checkout by default:

```bash
git clone https://github.com/raspberrypi/pico-sdk.git .deps/pico-sdk
git -C .deps/pico-sdk submodule update --init
```

You can also provide `PICO_SDK_PATH` yourself.

### Build

```bash
./scripts/build-codex-pico-ble-indicator.sh
```

Artifacts:

- `build-codex-pico-ble-indicator/codex_pico_ble_indicator.uf2`
- `build-codex-pico-ble-indicator/codex_pico_ble_indicator.bin`

### Flash

Manual flashing:

1. Hold `BOOTSEL`.
2. Plug in USB.
3. Copy `build-codex-pico-ble-indicator/codex_pico_ble_indicator.uf2` to `RP2350`.
4. Wait for the board to reboot.

Helper script:

```bash
./scripts/flash-codex-pico-ble-indicator.sh
```

Build first, then flash:

```bash
./scripts/flash-codex-pico-ble-indicator.sh --build
```

Detailed flashing and serial-log instructions are in [docs/flashing-and-reading.md](./docs/flashing-and-reading.md).

### State Values

The desktop bridge writes these states:

- `0`: off
- `1`: Codex is actively outputting
- `2`: Codex is quiet and waiting for the next user input

### Blink Behavior

- no BLE host connected: one short pulse about every `1200 ms`
- pairing or BLE transition in progress: fast blinking
- state `1`: two quick flashes per `1600 ms` cycle
- state `2`: fast blinking first, then solid on after about `15 s`
- if no new state write arrives for about `6 s`, the light falls back to off even if BLE remains connected

### Recovery Behavior

- short `BOOTSEL` press: restart BLE advertising
- long `BOOTSEL` press, about `1.8 s`: clear stored BLE bonds and restart advertising
- if the Python bridge stops sending heartbeats, the indicator turns off after timeout
- if the BLE link drops, the indicator returns to the disconnected pulse pattern

### Serial Logs

With a USB serial connection attached, startup logs look like:

```text
Boot: Codex Pico BLE indicator starting
Wi-Fi/Bluetooth stack init complete
BLE indicator advertising as codex-pico-ble
```

The firmware also logs pairing, disconnect, stale-bond cleanup, and state transitions.

## 中文

这个目录现在只保留 `Codex Pico BLE Indicator` 这套固件。

它是给 Pico 2 W 用的一个小型 BLE 外设，作用是给桌面端 Codex 桥接服务提供实体状态灯：

- BLE 设备名：`codex-pico-ble`
- 接收 Python 桥写入的状态值
- 提示 Codex 当前是在持续输出，还是在等待下一次输入
- 不提供键盘、鼠标或网页界面
- 不传输终端内容，也不接收用户输入

### 目录结构

```text
.
├── CMakeLists.txt
├── README.md
├── docs
│   └── flashing-and-reading.md
├── scripts
│   ├── build-codex-pico-ble-indicator.sh
│   └── flash-codex-pico-ble-indicator.sh
└── src
    ├── btstack_config.h
    ├── codex_pico_ble_indicator.c
    ├── codex_pico_ble_indicator.gatt
    └── tusb_config.h
```

### 依赖

```bash
sudo apt update
sudo apt install -y cmake gcc-arm-none-eabi libnewlib-arm-none-eabi build-essential git
```

仓库默认使用本地 Pico SDK：

```bash
git clone https://github.com/raspberrypi/pico-sdk.git .deps/pico-sdk
git -C .deps/pico-sdk submodule update --init
```

也可以自行提供 `PICO_SDK_PATH`。

### 构建

```bash
./scripts/build-codex-pico-ble-indicator.sh
```

产物：

- `build-codex-pico-ble-indicator/codex_pico_ble_indicator.uf2`
- `build-codex-pico-ble-indicator/codex_pico_ble_indicator.bin`

### 烧录

手动烧录：

1. 按住 `BOOTSEL`
2. 插上 USB
3. 把 `build-codex-pico-ble-indicator/codex_pico_ble_indicator.uf2` 拷到 `RP2350`
4. 等待板子自动重启

辅助脚本：

```bash
./scripts/flash-codex-pico-ble-indicator.sh
```

先构建再烧录：

```bash
./scripts/flash-codex-pico-ble-indicator.sh --build
```

更详细的烧录和串口日志读取说明见 [docs/flashing-and-reading.md](./docs/flashing-and-reading.md)。

### 状态值

桌面端桥会写入这些状态：

- `0`：熄灭
- `1`：Codex 正在持续输出
- `2`：Codex 当前安静，等待下一次用户输入

### 闪灯逻辑

- 未连接 BLE 主机：大约每 `1200 ms` 短闪一次
- 正在配对或蓝牙切换中：快速闪烁
- 状态 `1`：每 `1600 ms` 周期闪两下
- 状态 `2`：先快速闪烁，约 `15 s` 后转为常亮
- 如果大约 `6 s` 没收到新的状态写入，即使 BLE 仍然连着，也会自动回到熄灭

### 恢复逻辑

- 短按 `BOOTSEL`：重启 BLE 广播
- 长按 `BOOTSEL` 约 `1.8 s`：清空已保存的 BLE 配对信息，并重启广播
- 如果 Python 桥停止发送心跳，指示灯会在超时后自动熄灭
- 如果 BLE 链路断开，指示灯会回到断开态的短闪模式

### 串口日志

接上 USB 串口后，启动日志大致会是：

```text
Boot: Codex Pico BLE indicator starting
Wi-Fi/Bluetooth stack init complete
BLE indicator advertising as codex-pico-ble
```

固件还会打印配对、断开、清理旧 bond、状态切换等日志。
