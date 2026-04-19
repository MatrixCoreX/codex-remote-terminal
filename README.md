# Codex Remote Terminal

## English

### Overview

Codex Remote Terminal hosts a local `codex` CLI session as a LAN-accessible web terminal optimized for mobile browsers. It preserves terminal-style interaction, adds touch-friendly control keys, supports session recovery, loads shortcut prompts from JSON, and can optionally drive a Pico2W BLE status indicator.

### Features

- Real-time remote view of hosted `codex` terminal output
- Send keyboard input back into the PTY and preserve CLI-like behavior as much as possible
- Mobile-friendly controls such as `Esc`, `Enter`, arrows, `Ctrl+C`, `Tab`, `PgUp`, and `PgDn`
- Shortcut prompts loaded from [`static/shortcuts.json`](./static/shortcuts.json)
- Optional BLE indicator for Codex activity
- No reverse proxy required for basic LAN usage

### Requirements

- `codex` must be available in `PATH`
- Frontend assets must be installed with `npm install`
- The helper script expects `.venv/bin/python`
- BLE support is optional and requires `bleak` plus a working Linux BlueZ environment

### Quick Start

Install frontend assets first:

```bash
npm install
```

Start with the helper script:

```bash
./start_codex_remote.sh
```

By default, the script:

- uses `.venv/bin/python`
- binds to `0.0.0.0:8080`
- uses your current shell directory as the Codex working directory
- enables `codex --search` unless disabled
- tries to enable the BLE bridge, but automatically bypasses it when Bluetooth is unavailable

Common examples:

```bash
cd /path/to/workspace && /home/guagua/codex_remote_ctrl/start_codex_remote.sh
./start_codex_remote.sh --cwd /path/to/workspace
./start_codex_remote.sh --cwd /path/to/workspace --no-ble
./start_codex_remote.sh --cwd /path/to/workspace --no-search
./start_codex_remote.sh --cwd /path/to/workspace --ble-device-address XX:XX:XX:XX:XX:XX
./start_codex_remote.sh --cwd /path/to/workspace -- --full-auto
```

You can also start it directly with Python:

```bash
python3 codex_remote_http.py --host 0.0.0.0 --port 8080 -- codex --search
```

If you want Codex to run in another directory:

```bash
python3 codex_remote_http.py --host 0.0.0.0 --port 8080 --cwd /path/to/workspace -- codex --search
```

Then open it from another device on your LAN:

```text
http://your-local-ip:8080
```

### Script Options

Run `./start_codex_remote.sh --help` for the full list.

Important options:

- `--cwd DIR`: set the Codex working directory
- `--no-ble`: disable the BLE indicator explicitly
- `--search` / `--no-search`: enable or disable Codex live web search
- `--codex-bin PATH`: choose a different Codex executable
- `-- ...`: pass extra arguments to Codex

Examples:

```bash
./start_codex_remote.sh -- --model gpt-5.4
./start_codex_remote.sh --cwd /repo --no-search -- --full-auto
```

### Shortcut Prompt Config

Shortcut buttons are loaded from [`static/shortcuts.json`](./static/shortcuts.json).

Current format:

```json
{
  "items": [
    {
      "id": "continue",
      "label": { "zh": "继续", "en": "Continue" },
      "prompt": { "zh": "继续", "en": "continue" }
    }
  ]
}
```

- `label` controls the text shown on the button
- `prompt` is what gets sent to Codex immediately when tapped
- Both plain strings and `{ "zh": "...", "en": "..." }` objects are supported

After editing the file, refresh the page to pick up the new shortcuts.

### BLE Indicator

The BLE indicator is optional. It is designed to reuse a system-connected Pico2W peripheral named `codex-pico-ble` and mirror Codex activity as LED patterns.

The Pico firmware source used by this project is included in this repository under [`hardware/pico2w`](./hardware/pico2w).

Its purpose is only to act as a small physical status light beside your computer or desk, so you can tell whether Codex is still responding or already waiting for your next input without staring at the web page all the time.

It is not part of the main control path. It does not carry terminal data, does not send input to Codex, does not provide network access, and is not required for the web terminal to work.

Indicator meaning:

- slow blink: Codex is actively outputting
- rapid blink: Codex has finished the last response and is waiting for your next input
- off: no active session or the Python service has exited

Current firmware blink logic:

- BLE not connected yet: a short pulse about once every `1200 ms`, meaning the Pico is powered and waiting for the host to attach
- BLE pairing or transitioning: very fast flashing while the Bluetooth link is being established
- state `1` (`outputting`): two short pulses in each `1600 ms` cycle
- state `2` (`waiting`): a rapid flash pattern at first, then solid on after about `15 s`
- heartbeat timeout: if the Pico does not receive a fresh state write for about `6 s`, it falls back to `off` even if the BLE link is still connected

On the host side, the Python bridge rewrites the state periodically as a heartbeat, and only switches from `outputting` to `waiting` after Codex has been quiet for a short period instead of immediately on the first idle moment.

Install BLE dependencies only if you need this feature:

```bash
pip install -r requirements-ble.txt
```

If the current machine has no Bluetooth adapter, or BlueZ is unavailable, the BLE bridge is disabled automatically and the rest of the system keeps working normally.

### Notes

- The page uses `xterm.js`, and the backend hosts a real PTY. This is a remote CLI terminal, not a chat-only web UI.
- The current implementation is single-session. Restarting terminates the old session and launches a new one.
- The service has no built-in authentication by default. It is suitable only for a trusted LAN unless you add your own access control.
- `--search` enables Codex live web search. Disable it with `--no-search` or `CODEX_REMOTE_SEARCH=0` if you want a local-only session.
- The BLE waiting state is inferred from recent output activity instead of a direct internal Codex protocol signal, so it is an activity indicator rather than a strict protocol-level state machine.

### License

No license file is included yet. Add one before publishing the repository publicly if needed.

## 中文

### 项目简介

Codex Remote Terminal 会把本机的 `codex` CLI 会话托管成一个局域网可访问的网页终端，并针对手机浏览器做了优化。它尽量保留终端式交互，补充了适合触屏使用的控制键，支持会话恢复、通过 JSON 配置快捷语，并且可以选配 Pico2W BLE 状态指示灯。

### 特性

- 实时查看托管中的 `codex` 终端输出
- 将键盘输入回传到 PTY，尽量保持 CLI 原始行为
- 提供适合手机点击的 `Esc`、`Enter`、方向键、`Ctrl+C`、`Tab`、`PgUp`、`PgDn`
- 快捷语通过 [`static/shortcuts.json`](./static/shortcuts.json) 配置
- 可选 BLE 指示灯，用来显示 Codex 活动状态
- 基础局域网使用不依赖 Nginx 之类的反向代理

### 运行要求

- `codex` 命令需要已经在 `PATH` 中可用
- 前端资源需要先执行 `npm install`
- 一键脚本默认使用 `.venv/bin/python`
- BLE 功能是可选的，需要 `bleak` 和可用的 Linux BlueZ 环境

### 快速开始

先安装前端资源：

```bash
npm install
```

使用一键脚本启动：

```bash
./start_codex_remote.sh
```

脚本默认会：

- 使用 `.venv/bin/python`
- 监听 `0.0.0.0:8080`
- 把当前 shell 所在目录作为 Codex 工作目录
- 默认给 `codex` 打开 `--search`
- 默认尝试启用 BLE 桥，但如果蓝牙不可用会自动旁路，不影响主流程

常用例子：

```bash
cd /path/to/workspace && /home/guagua/codex_remote_ctrl/start_codex_remote.sh
./start_codex_remote.sh --cwd /path/to/workspace
./start_codex_remote.sh --cwd /path/to/workspace --no-ble
./start_codex_remote.sh --cwd /path/to/workspace --no-search
./start_codex_remote.sh --cwd /path/to/workspace --ble-device-address XX:XX:XX:XX:XX:XX
./start_codex_remote.sh --cwd /path/to/workspace -- --full-auto
```

也可以直接用 Python 启动：

```bash
python3 codex_remote_http.py --host 0.0.0.0 --port 8080 -- codex --search
```

如果你想让 Codex 在别的目录下运行：

```bash
python3 codex_remote_http.py --host 0.0.0.0 --port 8080 --cwd /path/to/workspace -- codex --search
```

然后在局域网内其他设备上访问：

```text
http://你的本机IP:8080
```

### 脚本参数

可以执行 `./start_codex_remote.sh --help` 查看完整参数列表。

常用参数：

- `--cwd DIR`：设置 Codex 工作目录
- `--no-ble`：显式关闭 BLE 指示灯
- `--search` / `--no-search`：开启或关闭 Codex 联网搜索
- `--codex-bin PATH`：指定不同的 Codex 可执行文件
- `-- ...`：把额外参数传给 Codex

示例：

```bash
./start_codex_remote.sh -- --model gpt-5.4
./start_codex_remote.sh --cwd /repo --no-search -- --full-auto
```

### 快捷语配置

快捷语按钮从 [`static/shortcuts.json`](./static/shortcuts.json) 读取。

当前格式：

```json
{
  "items": [
    {
      "id": "continue",
      "label": { "zh": "继续", "en": "Continue" },
      "prompt": { "zh": "继续", "en": "continue" }
    }
  ]
}
```

- `label` 控制按钮显示文字
- `prompt` 是点击后立即发送给 Codex 的内容
- 既支持纯字符串，也支持 `{ "zh": "...", "en": "..." }` 这种双语对象

改完这个文件后，刷新页面即可看到新的快捷语。

### BLE 指示灯

BLE 指示灯是可选功能。它的设计目标是复用系统里已经连接好的、名为 `codex-pico-ble` 的 Pico2W 外设，并把 Codex 活动状态映射成灯效。

这个项目使用的 Pico 固件源码已经一并放进当前仓库，位置在 [`hardware/pico2w`](./hardware/pico2w)。

它的用途只有一个：作为放在电脑旁边或桌面上的实体状态灯，让你不用一直盯着网页，也能知道 Codex 现在是在输出，还是已经停下来等你下一步输入。

它不属于主控制链路。它不会承载终端内容，不会给 Codex 发送输入，不提供网络转发，也不是网页终端运行所必需的组件。

灯效含义：

- 慢闪：Codex 正在输出
- 爆闪：Codex 上一轮输出结束，正在等你下一步输入
- 熄灭：没有活动会话，或者 Python 服务已经退出

当前固件里的闪灯逻辑：

- BLE 还没连上：大约每 `1200 ms` 短闪一次，表示 Pico 已经启动，正在等电脑端连上
- BLE 正在配对或切换连接：快速闪烁，表示蓝牙链路正在建立
- 状态 `1`（`outputting`）：每 `1600 ms` 一个周期内闪两下
- 状态 `2`（`waiting`）：一开始快速闪烁，大约 `15 s` 后转成常亮
- 心跳超时：如果 Pico 连续大约 `6 s` 没收到新的状态写入，即使 BLE 连接还在，也会自动回到熄灭态

电脑端的 Python 桥会定期重写状态作为心跳；同时它也不会在 Codex 刚一安静时就立刻切到等待态，而是会在安静一小段时间之后再从 `outputting` 切到 `waiting`。

只有在需要这个功能时才需要安装 BLE 依赖：

```bash
pip install -r requirements-ble.txt
```

如果当前机器没有蓝牙适配器，或者 BlueZ 不可用，BLE 桥会自动禁用，网页终端和 Codex 主流程仍然会继续正常运行。

### 说明

- 页面基于 `xterm.js`，后端托管的是真实 PTY，所以它本质上是远程 CLI，不是单纯聊天框。
- 当前实现是单会话模式。点击重启会结束旧会话并重新拉起新会话。
- 服务默认没有内建鉴权。除非你自己额外加访问控制，否则只适合部署在可信局域网。
- `--search` 会开启 Codex 的联网搜索；如果你想要纯本地会话，可以用 `--no-search` 或 `CODEX_REMOTE_SEARCH=0` 关闭。
- BLE 的等待态是根据最近输出活动推断出来的，不是直接读取 Codex 内部协议里的显式状态，所以它更接近“活动指示灯”，而不是严格的协议级状态机。

### 许可

当前仓库还没有单独的 license 文件；如果准备公开发布，建议先补上。
