const terminalElement = document.getElementById("terminal");
const statusPill = document.getElementById("status-pill");
const statusText = document.getElementById("status-text");
const commandLine = document.getElementById("command-line");
const commandStatusDot = document.getElementById("command-status-dot");
const terminalSize = document.getElementById("terminal-size");
const languageToggleButton = document.getElementById("toggle-language");
const historyStatus = document.getElementById("history-status");
const historyLatestButton = document.getElementById("history-latest");
const contentLog = document.getElementById("content-log");
const cliInputStrip = document.getElementById("cli-input-strip");
const cliInputLog = document.getElementById("cli-input-log");
const composerInput = document.getElementById("composer-input");
const composerSendButton = document.getElementById("composer-send");
const historyPanel = document.getElementById("history-panel");
const closeHistoryButton = document.getElementById("close-history");
const historyLog = document.getElementById("history-log");
const historySummary = document.getElementById("history-summary");
const shortcutPanel = document.getElementById("shortcut-panel");
const closeShortcutsButton = document.getElementById("close-shortcuts");
const shortcutGrid = document.getElementById("shortcut-grid");
const otherMenu = document.getElementById("other-menu");
const terminalStage = document.querySelector(".terminal-stage");
const touchInputBridge = document.getElementById("touch-input-bridge");
const touchInputPreview = document.getElementById("touch-input-preview");
const touchInputPreviewValue = document.getElementById("touch-input-preview-value");

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const hasTouchSupport = navigator.maxTouchPoints > 0 || "ontouchstart" in window;
const hasCoarsePointer = window.matchMedia?.("(any-pointer: coarse)")?.matches ?? false;
const isMobileLikeDevice = /Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(navigator.userAgent);
const useTouchInputBridge = Boolean(
  touchInputBridge && (isMobileLikeDevice || (hasTouchSupport && hasCoarsePointer)),
);
const defaultFlushDelayMs = useTouchInputBridge ? 42 : 16;
const defaultResizeDelayMs = useTouchInputBridge ? 140 : 80;
const terminalSnapshotCacheKey = "codex_remote_snapshot_v1";
const terminalBufferCacheKey = "codex_remote_buffer_v1";
const terminalPlainTranscriptCacheKey = "codex_remote_plain_transcript_v1";
const maxSnapshotCacheB64Length = 2_000_000;
const maxBufferCacheTextLength = 1_000_000;
const maxPlainTranscriptLength = 1_000_000;
const terminalSnapshotWriteChunkBytes = 24 * 1024;
const plainTranscriptCacheVersion = 2;
const localeStorageKey = "codex_remote_locale_v1";
const shortcutConfigPath = "/shortcuts.json";
const terminalSnapshotStores = [
  ["sessionStorage", () => window.sessionStorage],
  ["localStorage", () => window.localStorage],
];
const supportedLocales = new Set(["zh", "en"]);
const localeDocumentLang = {
  zh: "zh-CN",
  en: "en",
};
const translations = {
  zh: {
    document_title: "Codex 远程终端",
    switch_language: "切换到英文",
    terminal_input_bridge: "终端输入桥",
    composer_placeholder: "给 Codex 发一句话，回车发送",
    composer_send: "发送",
    history_title: "会话记录",
    close_panel: "收起",
    shortcuts_title: "快捷语",
    shortcuts_summary: "把常用提示词收在一起。",
    arrow_keys: "方向键",
    restart_codex: "重启 Codex",
    history_button: "记录",
    eyebrow_title: "局域网远程终端",
    page_heading: "Codex 远程终端",
    status_connecting: "连接中",
    status_waiting_output: "等待 Codex 输出...",
    history_preserved_chars: "已保留 {{count}} 个字符的旧输出。",
    history_preserved_empty: "保留被终端重绘盖掉的旧输出。",
    history_mirrored_chars: "已镜像 {{count}} 个字符的 CLI 缓冲区内容。",
    history_mirrored_empty: "镜像当前 CLI 缓冲区内容。",
    history_unseen_output: "新输出 {{count}}",
    history_top: "历史 顶部",
    history_lines_up: "历史 {{count}} 行前",
    history_latest: "最新",
    history_latest_unseen: "最新 +{{count}}",
    status_network_jitter: "网络抖动，正在补发输入",
    status_restoring: "恢复连接中",
    status_connection_issue: "连接异常，正在恢复",
    status_service_unreachable: "无法连接服务",
    status_running: "运行中 PID {{pid}}",
    status_exited: "已退出{{suffix}}",
    status_stream_recovering: "连接中断，自动恢复",
    status_restarting: "正在重启 Codex",
    status_restart_failed: "重启失败",
  },
  en: {
    document_title: "Codex Remote",
    switch_language: "Switch to Chinese",
    terminal_input_bridge: "Terminal Input Bridge",
    composer_placeholder: "Message Codex and press Enter to send",
    composer_send: "Send",
    history_title: "Session History",
    close_panel: "Close",
    shortcuts_title: "Shortcuts",
    shortcuts_summary: "Keep common prompts in one place.",
    arrow_keys: "Arrow keys",
    restart_codex: "Restart",
    history_button: "History",
    eyebrow_title: "LAN Remote Terminal",
    page_heading: "Codex Remote",
    status_connecting: "Connecting",
    status_waiting_output: "Waiting for Codex output...",
    history_preserved_chars: "Preserved {{count}} chars of older output.",
    history_preserved_empty: "Preserving older output covered by terminal repaint.",
    history_mirrored_chars: "Mirrored {{count}} chars from the current CLI buffer.",
    history_mirrored_empty: "Mirroring the current CLI buffer.",
    history_unseen_output: "New output {{count}}",
    history_top: "History top",
    history_lines_up: "{{count}} lines up",
    history_latest: "Latest",
    history_latest_unseen: "Latest +{{count}}",
    status_network_jitter: "Network jitter, retrying input",
    status_restoring: "Restoring connection",
    status_connection_issue: "Connection issue, recovering",
    status_service_unreachable: "Service unavailable",
    status_running: "Running PID {{pid}}",
    status_exited: "Exited{{suffix}}",
    status_stream_recovering: "Stream disconnected, recovering",
    status_restarting: "Restarting Codex",
    status_restart_failed: "Restart failed",
  },
};

document.body.dataset.touchMode = useTouchInputBridge ? "true" : "false";

const term = new window.Terminal({
  allowProposedApi: false,
  convertEol: false,
  cursorBlink: true,
  fontFamily: '"JetBrains Mono", "Fira Code", "IBM Plex Mono", monospace',
  fontSize: 11,
  scrollback: 20000,
  theme: {
    background: "#0c0f11",
    foreground: "#f3efe7",
    cursor: "#ffbf69",
    black: "#0c0f11",
    red: "#ff6b6b",
    green: "#88d498",
    yellow: "#ffd166",
    blue: "#78c0e0",
    magenta: "#f087b3",
    cyan: "#7bdff2",
    white: "#f3efe7",
    brightBlack: "#5d656d",
    brightRed: "#ff8d8d",
    brightGreen: "#a8e6b4",
    brightYellow: "#ffe08b",
    brightBlue: "#9dd6ec",
    brightMagenta: "#f6a7ca",
    brightCyan: "#a8ecfa",
    brightWhite: "#fffaf2",
    selectionBackground: "#40505a",
  },
});

const fitAddon = new window.FitAddon.FitAddon();
term.loadAddon(fitAddon);
term.open(terminalElement);

const specialSequences = {
  esc: "\u001b",
  insert_key: "\u001b[2~",
  tab: "\t",
  enter: "\r",
  ctrl_c: "\u0003",
  ctrl_l: "\u000c",
  up: "\u001b[A",
  down: "\u001b[B",
  left: "\u001b[D",
  right: "\u001b[C",
  home: "\u001b[H",
  end: "\u001b[F",
  page_up: "\u001b[5~",
  page_down: "\u001b[6~",
};

let flushTimer = null;
let flushInFlight = false;
let flushRetryDelayMs = 0;
let pendingChunks = [];
let eventSource = null;
let resizeTimer = null;
let touchBridgeComposing = false;
let touchBridgePreviewText = "";
let touchBridgeFocused = false;
let touchBridgePreviewFrame = 0;
let touchBridgePreviewLayoutDirty = true;
let touchBridgePreviewLayout = null;
let lastEventId = 0;
let viewportMetrics = null;
let lastServerContactAt = 0;
let lastStreamContactAt = 0;
let lastHealthcheckFailureAt = 0;
let sessionRefreshTimer = null;
let sessionRefreshInFlight = null;
let healthcheckTimer = null;
let lastSessionPid = null;
let lastSessionStartedAt = null;
let unseenOutputCount = 0;
let historyRepeatDelayTimer = null;
let historyRepeatInterval = null;
let historyRepeatSuppressClickUntil = 0;
let snapshotCacheRefreshTimer = null;
let snapshotCacheRefreshInFlight = null;
let bufferCacheRefreshTimer = null;
let renderedTranscriptBytes = 0;
let renderedSnapshotFingerprint = null;
let transcriptWriteToken = 0;
let currentSessionStatus = null;
let currentStatusState = {
  type: "key",
  key: "status_connecting",
  params: {},
  mode: "offline",
};
let terminalTapPointerId = null;
let terminalTapMoved = false;
let terminalTapStartX = 0;
let terminalTapStartY = 0;
let suppressTerminalClickUntil = 0;
let plainTranscriptText = "";
let plainTranscriptCurrentLine = "";
let plainTranscriptCacheRefreshTimer = null;
let composerResizeFrame = 0;
let keyboardLayoutFrame = 0;
let tapActionSuppressUntil = 0;
let terminalMirrorFrame = 0;
let contentLogPinnedToLatest = true;
let currentLocale = readStoredLocale();
let shortcutDefinitions = [
  {
    id: "continue",
    label: { zh: "继续", en: "Continue" },
    prompt: { zh: "继续", en: "continue" },
  },
  {
    id: "rollback",
    label: { zh: "回滚", en: "Rollback" },
    prompt: { zh: "回滚", en: "rollback" },
  },
  {
    id: "plain_words",
    label: { zh: "说人话", en: "Plainly" },
    prompt: { zh: "说人话", en: "say it plainly" },
  },
];

function resolveLocale(locale) {
  return supportedLocales.has(locale) ? locale : "zh";
}

function readStoredLocale() {
  try {
    return resolveLocale(window.localStorage.getItem(localeStorageKey));
  } catch {
    return "zh";
  }
}

function writeStoredLocale(locale) {
  try {
    window.localStorage.setItem(localeStorageKey, resolveLocale(locale));
  } catch {}
}

function interpolateText(template, params = {}) {
  return String(template).replace(/\{\{(\w+)\}\}/g, (match, key) => `${params[key] ?? ""}`);
}

function t(key, params = {}) {
  const locale = resolveLocale(currentLocale);
  const template = translations[locale]?.[key] ?? translations.zh[key] ?? key;
  return interpolateText(template, params);
}

function resolveLocalizedConfigValue(value, locale = currentLocale) {
  if (typeof value === "string") {
    return value;
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  if (typeof value[locale] === "string") {
    return value[locale];
  }
  if (typeof value.zh === "string") {
    return value.zh;
  }
  if (typeof value.en === "string") {
    return value.en;
  }
  const firstString = Object.values(value).find((entry) => typeof entry === "string");
  return typeof firstString === "string" ? firstString : "";
}

function normalizeShortcutDefinition(item, index) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const label = item.label ?? item.title ?? item.name;
  const prompt = item.prompt ?? item.text ?? item.value ?? item.preset;
  const resolvedLabel = resolveLocalizedConfigValue(label);
  const resolvedPrompt = resolveLocalizedConfigValue(prompt);
  if (!resolvedLabel || !resolvedPrompt) {
    return null;
  }

  return {
    id: typeof item.id === "string" && item.id ? item.id : `shortcut_${index + 1}`,
    label,
    prompt,
  };
}

function normalizeShortcutConfig(payload) {
  const items = Array.isArray(payload) ? payload : payload?.items;
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .map((item, index) => normalizeShortcutDefinition(item, index))
    .filter(Boolean);
}

function getShortcutLabel(definition) {
  return resolveLocalizedConfigValue(definition?.label);
}

function getShortcutPrompt(definition) {
  return resolveLocalizedConfigValue(definition?.prompt);
}

function sendShortcutPrompt(definition) {
  const prompt = getShortcutPrompt(definition);
  if (!prompt) {
    return;
  }
  sendPrompt(prompt);
  closeOtherMenu();
  hideShortcutPanel();
  restoreTerminalFocus();
}

function renderShortcutButtons() {
  if (!shortcutGrid) {
    return;
  }

  shortcutGrid.textContent = "";
  shortcutDefinitions.forEach((definition) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "action shortcut-action";
    button.textContent = getShortcutLabel(definition);
    button.dataset.shortcutId = definition.id;
    installTapAction(button, () => {
      sendShortcutPrompt(definition);
    });
    shortcutGrid.append(button);
  });
}

async function loadShortcutConfig() {
  try {
    const response = await fetch(`${shortcutConfigPath}?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`shortcut config request failed: ${response.status}`);
    }
    const payload = await response.json();
    const nextDefinitions = normalizeShortcutConfig(payload);
    if (!nextDefinitions.length) {
      throw new Error("shortcut config is empty");
    }
    shortcutDefinitions = nextDefinitions;
    renderShortcutButtons();
  } catch (error) {
    console.error("failed to load shortcut config", error);
  }
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(data) {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function estimateBase64ByteLength(data = "") {
  if (!data) {
    return 0;
  }
  const padding = data.endsWith("==") ? 2 : (data.endsWith("=") ? 1 : 0);
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

function writeTerminalBytesChunked(bytes, callback) {
  const token = ++transcriptWriteToken;
  const total = bytes?.length ?? 0;

  if (!total) {
    callback?.();
    return;
  }

  let offset = 0;
  const writeNext = () => {
    if (token !== transcriptWriteToken) {
      return;
    }
    if (offset >= total) {
      callback?.();
      return;
    }

    const nextOffset = Math.min(offset + terminalSnapshotWriteChunkBytes, total);
    const chunk = bytes.subarray(offset, nextOffset);
    offset = nextOffset;
    term.write(chunk, () => {
      if (offset >= total) {
        callback?.();
        return;
      }
      window.requestAnimationFrame(writeNext);
    });
  };

  writeNext();
}

function getSnapshotFingerprint(status = {}, outputBytes = 0) {
  return `${status.pid ?? ""}:${status.started_at ?? ""}:${outputBytes}`;
}

function withSnapshotStores(callback) {
  for (const [name, getStore] of terminalSnapshotStores) {
    try {
      const store = getStore();
      if (!store) {
        continue;
      }
      callback(store, name);
    } catch (error) {
      console.error(`snapshot store unavailable: ${name}`, error);
    }
  }
}

function readSnapshotCache() {
  let newest = null;
  let newestSavedAt = -1;

  withSnapshotStores((store, name) => {
    try {
      const raw = store.getItem(terminalSnapshotCacheKey);
      if (!raw) {
        return;
      }
      const cached = JSON.parse(raw);
      if (!cached?.status || typeof cached.output_b64 !== "string") {
        store.removeItem(terminalSnapshotCacheKey);
        return;
      }
      const savedAt = Number(cached.saved_at ?? 0);
      if (savedAt >= newestSavedAt) {
        newest = cached;
        newestSavedAt = savedAt;
      }
    } catch (error) {
      console.error(`failed to read terminal snapshot cache from ${name}`, error);
    }
  });

  return newest;
}

function clearSnapshotCache() {
  withSnapshotStores((store, name) => {
    try {
      store.removeItem(terminalSnapshotCacheKey);
    } catch (error) {
      console.error(`failed to clear terminal snapshot cache from ${name}`, error);
    }
  });
}

function writeSnapshotCache(snapshot) {
  if (!snapshot?.status) {
    return;
  }

  const outputB64 = typeof snapshot.output_b64 === "string" ? snapshot.output_b64 : "";
  if (outputB64.length > maxSnapshotCacheB64Length) {
    clearSnapshotCache();
    return;
  }

  const payload = {
    saved_at: Date.now(),
    status: snapshot.status,
    output_b64: outputB64,
    output_bytes: Number(snapshot.output_bytes ?? estimateBase64ByteLength(outputB64)),
  };

  const serialized = JSON.stringify(payload);
  withSnapshotStores((store, name) => {
    try {
      store.setItem(terminalSnapshotCacheKey, serialized);
    } catch (error) {
      console.error(`failed to write terminal snapshot cache to ${name}`, error);
    }
  });
}

function getCacheableStatus() {
  if (!currentSessionStatus) {
    return null;
  }
  return {
    ...currentSessionStatus,
    pid: lastSessionPid ?? currentSessionStatus.pid ?? null,
    started_at: lastSessionStartedAt ?? currentSessionStatus.started_at ?? null,
    cols: term.cols || currentSessionStatus.cols,
    rows: term.rows || currentSessionStatus.rows,
    last_event_id: Number(lastEventId || currentSessionStatus.last_event_id || 0),
  };
}

function captureTerminalBufferCache() {
  const status = getCacheableStatus();
  const buffer = term?.buffer?.active;
  if (!status || !buffer) {
    return null;
  }

  const lines = [];
  for (let index = 0; index < buffer.length; index += 1) {
    const line = buffer.getLine(index);
    lines.push(line ? line.translateToString(true) : "");
  }

  let keptLines = lines;
  let bufferText = keptLines.join("\r\n");
  let trimmedHeadLines = 0;
  if (bufferText.length > maxBufferCacheTextLength) {
    keptLines = [];
    let keptLength = 0;
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index];
      const lineLength = line.length + (keptLines.length > 0 ? 2 : 0);
      if (keptLines.length > 0 && keptLength + lineLength > maxBufferCacheTextLength) {
        break;
      }
      keptLines.push(line);
      keptLength += lineLength;
    }
    keptLines.reverse();
    trimmedHeadLines = Math.max(0, lines.length - keptLines.length);
    bufferText = keptLines.join("\r\n");
  }

  return {
    saved_at: Date.now(),
    status,
    buffer_text: bufferText,
    output_bytes: Number(renderedTranscriptBytes || 0),
    viewport_y: Math.max(0, Number(buffer.viewportY ?? 0) - trimmedHeadLines),
    base_y: Math.max(0, Number(buffer.baseY ?? 0) - trimmedHeadLines),
    distance_from_latest: Math.max(
      0,
      Math.min(
        Number(buffer.baseY ?? 0) - Number(buffer.viewportY ?? 0),
        Math.max(0, keptLines.length - 1),
      ),
    ),
    line_count: Number(keptLines.length ?? 0),
  };
}

function readBufferCache() {
  let newest = null;
  let newestSavedAt = -1;

  withSnapshotStores((store, name) => {
    try {
      const raw = store.getItem(terminalBufferCacheKey);
      if (!raw) {
        return;
      }
      const cached = JSON.parse(raw);
      if (!cached?.status || typeof cached.buffer_text !== "string") {
        store.removeItem(terminalBufferCacheKey);
        return;
      }
      const savedAt = Number(cached.saved_at ?? 0);
      if (savedAt >= newestSavedAt) {
        newest = cached;
        newestSavedAt = savedAt;
      }
    } catch (error) {
      console.error(`failed to read terminal buffer cache from ${name}`, error);
    }
  });

  return newest;
}

function clearBufferCache() {
  withSnapshotStores((store, name) => {
    try {
      store.removeItem(terminalBufferCacheKey);
    } catch (error) {
      console.error(`failed to clear terminal buffer cache from ${name}`, error);
    }
  });
}

function writeBufferCache(cache) {
  if (!cache?.status || typeof cache.buffer_text !== "string") {
    return;
  }

  if (cache.buffer_text.length > maxBufferCacheTextLength) {
    clearBufferCache();
    return;
  }

  const serialized = JSON.stringify(cache);
  withSnapshotStores((store, name) => {
    try {
      store.setItem(terminalBufferCacheKey, serialized);
    } catch (error) {
      console.error(`failed to write terminal buffer cache to ${name}`, error);
    }
  });
}

function scheduleBufferCacheRefresh(delay = 600) {
  if (bufferCacheRefreshTimer) {
    return;
  }
  bufferCacheRefreshTimer = window.setTimeout(() => {
    bufferCacheRefreshTimer = null;
    refreshBufferCache();
  }, delay);
}

function refreshBufferCache() {
  const cache = captureTerminalBufferCache();
  if (!cache) {
    return false;
  }
  writeBufferCache(cache);
  return true;
}

function getPlainTranscriptSessionKey(status = {}) {
  return `${status.pid ?? ""}:${status.started_at ?? ""}`;
}

function getPlainTranscriptValue() {
  return plainTranscriptCurrentLine
    ? `${plainTranscriptText}${plainTranscriptCurrentLine}`
    : plainTranscriptText;
}

function trimEdgeBlankLines(lines = []) {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) {
    start += 1;
  }
  while (end > start && !lines[end - 1].trim()) {
    end -= 1;
  }
  return lines.slice(start, end);
}

function trimTrailingBlankLines(lines = []) {
  let end = lines.length;
  while (end > 0 && !lines[end - 1].trim()) {
    end -= 1;
  }
  return lines.slice(0, end);
}

function getTerminalBufferLines() {
  const buffer = term?.buffer?.active;
  if (!buffer) {
    return [];
  }

  const lines = [];
  for (let index = 0; index < buffer.length; index += 1) {
    const line = buffer.getLine(index);
    lines.push(line ? line.translateToString(true).replace(/\u00a0/g, " ") : "");
  }
  return trimEdgeBlankLines(lines);
}

function getTerminalBufferDisplayText() {
  const lines = getTerminalBufferLines();
  if (!lines.length) {
    return "";
  }
  return trimPlainTranscriptText(lines.join("\n"));
}

const cliPromptLinePattern = /^\s*›/;
const cliMenuSelectionLinePattern = /^\s*›\s*(?:\/\S*|\d+\.)/;
const cliModelLinePattern = /^\s*gpt-[\w.-]+\b/i;
const cliStatusLinePattern =
  /^\s*[•·].*(?:esc to interrupt|working|thinking|responding|reading|planning|waiting|analyzing)/i;

function findCliFooterStart(lines = [], lastNonEmpty = -1) {
  if (!lines.length || lastNonEmpty < 0) {
    return -1;
  }

  for (let index = lastNonEmpty; index >= Math.max(0, lastNonEmpty - 6); index -= 1) {
    if (
      !cliPromptLinePattern.test(lines[index]) ||
      cliMenuSelectionLinePattern.test(lines[index])
    ) {
      continue;
    }
    let start = index;
    while (start > 0) {
      const previous = lines[start - 1];
      if (!previous.trim()) {
        start -= 1;
        continue;
      }
      if (cliModelLinePattern.test(previous) || cliStatusLinePattern.test(previous)) {
        start -= 1;
        continue;
      }
      break;
    }
    return start;
  }

  const lastLine = lines[lastNonEmpty] ?? "";
  if (cliModelLinePattern.test(lastLine) || cliStatusLinePattern.test(lastLine)) {
    return lastNonEmpty;
  }

  return -1;
}

function splitTerminalDisplaySections(lines = []) {
  if (!lines.length) {
    return {
      contentText: "",
      footerText: "",
      mirrorText: "",
    };
  }

  const mirrorLines = trimEdgeBlankLines(lines);
  if (!mirrorLines.length) {
    return {
      contentText: "",
      footerText: "",
      mirrorText: "",
    };
  }

  let lastNonEmpty = mirrorLines.length - 1;
  while (lastNonEmpty >= 0 && !mirrorLines[lastNonEmpty].trim()) {
    lastNonEmpty -= 1;
  }

  const mirrorText = trimPlainTranscriptText(mirrorLines.join("\n"));
  const footerStart = findCliFooterStart(mirrorLines, lastNonEmpty);
  if (footerStart === -1) {
    return {
      contentText: mirrorText,
      footerText: "",
      mirrorText,
    };
  }

  const contentLines = trimTrailingBlankLines(mirrorLines.slice(0, footerStart));
  const footerLines = trimEdgeBlankLines(mirrorLines.slice(footerStart, lastNonEmpty + 1));
  return {
    contentText: trimPlainTranscriptText(contentLines.join("\n")),
    footerText: trimPlainTranscriptText(footerLines.join("\n")),
    mirrorText,
  };
}

function isContentLogNearBottom() {
  if (!contentLog) {
    return true;
  }
  const remaining = contentLog.scrollHeight - contentLog.scrollTop - contentLog.clientHeight;
  return remaining <= 24;
}

function scrollContentLogToBottom() {
  if (!contentLog) {
    return;
  }
  contentLog.scrollTop = contentLog.scrollHeight;
}

function scheduleTerminalMirrorRefresh() {
  if (terminalMirrorFrame) {
    return;
  }
  terminalMirrorFrame = window.requestAnimationFrame(() => {
    terminalMirrorFrame = 0;
    syncPlainTranscriptToUi();
  });
}

function trimPlainTranscriptText(text) {
  if (text.length <= maxPlainTranscriptLength) {
    return text;
  }
  const trimmed = text.slice(text.length - maxPlainTranscriptLength);
  const firstNewline = trimmed.indexOf("\n");
  if (firstNewline === -1) {
    return trimmed;
  }
  return trimmed.slice(firstNewline + 1);
}

function writePlainTranscriptCache(payload) {
  if (!payload?.status || typeof payload.text !== "string") {
    return;
  }

  const serialized = JSON.stringify({
    version: plainTranscriptCacheVersion,
    saved_at: Date.now(),
    status: payload.status,
    text: trimPlainTranscriptText(payload.text),
  });

  withSnapshotStores((store, name) => {
    try {
      store.setItem(terminalPlainTranscriptCacheKey, serialized);
    } catch (error) {
      console.error(`failed to write plain transcript cache to ${name}`, error);
    }
  });
}

function readPlainTranscriptCache() {
  let newest = null;
  let newestSavedAt = -1;

  withSnapshotStores((store, name) => {
    try {
      const raw = store.getItem(terminalPlainTranscriptCacheKey);
      if (!raw) {
        return;
      }
      const cached = JSON.parse(raw);
      if (
        cached?.version !== plainTranscriptCacheVersion ||
        !cached?.status ||
        typeof cached.text !== "string"
      ) {
        store.removeItem(terminalPlainTranscriptCacheKey);
        return;
      }
      const savedAt = Number(cached.saved_at ?? 0);
      if (savedAt >= newestSavedAt) {
        newest = cached;
        newestSavedAt = savedAt;
      }
    } catch (error) {
      console.error(`failed to read plain transcript cache from ${name}`, error);
    }
  });

  return newest;
}

function clearPlainTranscriptCache() {
  withSnapshotStores((store, name) => {
    try {
      store.removeItem(terminalPlainTranscriptCacheKey);
    } catch (error) {
      console.error(`failed to clear plain transcript cache from ${name}`, error);
    }
  });
}

function syncPlainTranscriptToUi() {
  const transcriptValue = getPlainTranscriptValue() || t("status_waiting_output");
  const displaySections = splitTerminalDisplaySections(getTerminalBufferLines());
  const terminalMirrorValue = displaySections.mirrorText || transcriptValue;
  const contentValue = displaySections.contentText || (displaySections.mirrorText ? "" : transcriptValue);
  const footerValue = displaySections.footerText || "";

  if (contentLog) {
    const shouldStick = contentLogPinnedToLatest || isContentLogNearBottom();
    contentLog.textContent = contentValue;
    if (shouldStick) {
      window.requestAnimationFrame(() => {
        scrollContentLogToBottom();
      });
    }
    contentLogPinnedToLatest = shouldStick;
  }

  if (cliInputLog) {
    cliInputLog.textContent = footerValue || "›";
  }

  if (!historyLog) {
    if (historySummary) {
      const textLength = getPlainTranscriptValue().length;
      historySummary.textContent = textLength
        ? t("history_preserved_chars", { count: textLength })
        : t("history_preserved_empty");
    }
    return;
  }
  historyLog.textContent = terminalMirrorValue;
  if (historyPanel && !historyPanel.classList.contains("hidden")) {
    historyLog.scrollTop = historyLog.scrollHeight;
  }
  if (historySummary) {
    const textLength = terminalMirrorValue.length;
    historySummary.textContent = textLength
      ? t("history_mirrored_chars", { count: textLength })
      : t("history_mirrored_empty");
  }
}

function schedulePlainTranscriptCacheRefresh(delay = 500) {
  if (plainTranscriptCacheRefreshTimer) {
    return;
  }
  plainTranscriptCacheRefreshTimer = window.setTimeout(() => {
    plainTranscriptCacheRefreshTimer = null;
    refreshPlainTranscriptCache();
  }, delay);
}

function refreshPlainTranscriptCache() {
  const status = getCacheableStatus();
  if (!status) {
    return false;
  }
  writePlainTranscriptCache({
    status,
    text: getPlainTranscriptValue(),
  });
  return true;
}

function resetPlainTranscript() {
  textDecoder.decode(new Uint8Array(), { stream: false });
  plainTranscriptText = "";
  plainTranscriptCurrentLine = "";
  clearPlainTranscriptCache();
  syncPlainTranscriptToUi();
}

function setPlainTranscript(text = "") {
  const normalized = trimPlainTranscriptText(text.replace(/\r\n/g, "\n"));
  const lastNewline = normalized.lastIndexOf("\n");
  if (lastNewline === -1) {
    plainTranscriptText = "";
    plainTranscriptCurrentLine = normalized;
  } else {
    plainTranscriptText = normalized.slice(0, lastNewline + 1);
    plainTranscriptCurrentLine = normalized.slice(lastNewline + 1);
  }
  syncPlainTranscriptToUi();
}

const transientTranscriptLinePatterns = [
  /^(?:[•·]\s*)?(?:Working|Booting MCP server|Analyzing|Planning|Reading|Searching|Updating|Thinking|Waiting|Responding|Applying|Explored)\b.*$/i,
  /^(?:[└├│]\s+.*)$/u,
  /^gpt-[\w.-]+ .* · .*$/i,
  /^›\s+.+$/u,
];
const transcriptNoiseFragmentPattern = /(Working|Workin|Worki|Work|Wor|orking|rking|king|ingngg)/gi;
const transcriptNoiseTrimPattern = /(?:[• ]*(?:Working|Workin|Worki|Work|Wor|orking|rking|king|ingngg)\d*)+$/gi;

function isTransientTranscriptLine(line = "") {
  return transientTranscriptLinePatterns.some((pattern) => pattern.test(line));
}

function stripTranscriptNoise(line = "") {
  const trimmedTrailingNoise = line.replace(transcriptNoiseTrimPattern, "").trim();
  if (!trimmedTrailingNoise) {
    return "";
  }

  const fragmentMatches = trimmedTrailingNoise.match(transcriptNoiseFragmentPattern) ?? [];
  if (fragmentMatches.length >= 2) {
    const cleanedInlineNoise = fragmentMatches.length >= 3
      ? trimmedTrailingNoise
        .replace(/(?:[• ]*(?:Working|Workin|Worki|Work|Wor|orking|rking|king|ingngg)\d*)+/gi, " ")
        .replace(/[•]+/g, " ")
        .replace(/[ \t]+/g, " ")
        .trim()
      : trimmedTrailingNoise;
    const remainder = cleanedInlineNoise
      .replace(transcriptNoiseFragmentPattern, "")
      .replace(/[•0-9\s─╭╰│┌┐└┘├┤┬┴┼]+/gu, "");
    if (remainder.length <= 4) {
      return "";
    }
    return cleanedInlineNoise;
  }

  return trimmedTrailingNoise;
}

function normalizeTranscriptLine(rawLine = "") {
  let line = rawLine.replace(/\u00a0/g, " ");
  line = line.replace(/^│\s*/, "").replace(/\s*│$/, "");
  line = line.replace(/[ \t]+/g, " ").trim();
  line = stripTranscriptNoise(line);

  if (!line) {
    return "";
  }

  if (/^[╭╰│─┌┐└┘├┤┬┴┼ ]+$/u.test(line)) {
    return "";
  }

  if (/esc to interrupt/i.test(line)) {
    return "";
  }

  if (!line || isTransientTranscriptLine(line)) {
    return "";
  }

  return line;
}

function pushPlainTranscriptLine(force = false) {
  const line = normalizeTranscriptLine(plainTranscriptCurrentLine.replace(/[ \t]+$/g, ""));
  if (!line) {
    plainTranscriptCurrentLine = "";
    return;
  }

  if (!force) {
    const existingText = plainTranscriptText.endsWith("\n")
      ? plainTranscriptText.slice(0, -1)
      : plainTranscriptText;
    const previousLine = existingText.slice(existingText.lastIndexOf("\n") + 1);
    if (previousLine === line) {
      plainTranscriptCurrentLine = "";
      return;
    }
  }

  plainTranscriptText = trimPlainTranscriptText(`${plainTranscriptText}${line}\n`);
  plainTranscriptCurrentLine = "";
}

function consumePlainTranscriptText(text = "") {
  let index = 0;
  while (index < text.length) {
    const char = text[index];

    if (char === "\x1b") {
      const next = text[index + 1];
      if (next === "[") {
        index += 2;
        while (index < text.length && !/[@-~]/.test(text[index])) {
          index += 1;
        }
        index += 1;
        continue;
      }
      if (next === "]") {
        index += 2;
        while (index < text.length) {
          if (text[index] === "\x07") {
            index += 1;
            break;
          }
          if (text[index] === "\x1b" && text[index + 1] === "\\") {
            index += 2;
            break;
          }
          index += 1;
        }
        continue;
      }
      index += 2;
      continue;
    }

    if (char === "\r") {
      if (text[index + 1] !== "\n") {
        plainTranscriptCurrentLine = "";
      }
      index += 1;
      continue;
    }

    if (char === "\n") {
      pushPlainTranscriptLine(true);
      index += 1;
      continue;
    }

    if (char === "\b") {
      plainTranscriptCurrentLine = plainTranscriptCurrentLine.slice(0, -1);
      index += 1;
      continue;
    }

    if (char === "\t") {
      plainTranscriptCurrentLine += "    ";
      index += 1;
      continue;
    }

    if (char < " ") {
      index += 1;
      continue;
    }

    plainTranscriptCurrentLine += char;
    index += 1;
  }

  const combined = trimPlainTranscriptText(getPlainTranscriptValue());
  const lastNewline = combined.lastIndexOf("\n");
  if (lastNewline === -1) {
    plainTranscriptText = "";
    plainTranscriptCurrentLine = combined;
  } else {
    plainTranscriptText = combined.slice(0, lastNewline + 1);
    plainTranscriptCurrentLine = combined.slice(lastNewline + 1);
  }

  syncPlainTranscriptToUi();
}

function appendPlainTranscriptChunk(dataB64) {
  if (!dataB64) {
    return;
  }
  consumePlainTranscriptText(textDecoder.decode(base64ToBytes(dataB64), { stream: true }));
  schedulePlainTranscriptCacheRefresh();
}

function rebuildPlainTranscriptFromSnapshot(snapshot) {
  const outputB64 = typeof snapshot?.output_b64 === "string" ? snapshot.output_b64 : "";
  if (!outputB64) {
    setPlainTranscript("");
    refreshPlainTranscriptCache();
    return;
  }
  textDecoder.decode(new Uint8Array(), { stream: false });
  setPlainTranscript("");
  consumePlainTranscriptText(textDecoder.decode(base64ToBytes(outputB64)));
  refreshPlainTranscriptCache();
}

function restorePlainTranscriptCache() {
  const cached = readPlainTranscriptCache();
  if (!cached?.status) {
    return false;
  }
  setPlainTranscript(cached.text);
  if (!currentSessionStatus) {
    renderStatus(cached.status);
    updateSessionIdentity(cached.status);
  }
  return true;
}

async function fetchSnapshot({ keepalive = false } = {}) {
  const response = await fetch(`/api/snapshot?t=${Date.now()}`, {
    cache: "no-store",
    keepalive,
    headers: {
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });
  if (!response.ok) {
    throw new Error(`/api/snapshot failed: ${response.status}`);
  }
  return response.json();
}

function restoreTerminalViewport(distanceFromLatest = 0) {
  const buffer = term?.buffer?.active;
  if (!buffer) {
    return;
  }
  if (distanceFromLatest <= 0) {
    term.scrollToBottom();
    return;
  }
  const targetLine = Math.max(0, Number(buffer.baseY ?? 0) - distanceFromLatest);
  term.scrollToLine(targetLine);
}

function applyBufferCache(cache, { cacheOnly = false } = {}) {
  const status = cache?.status;
  if (!status) {
    return false;
  }

  const bufferText = typeof cache.buffer_text === "string" ? cache.buffer_text : "";
  const lineCount = Number(cache.line_count ?? 0);
  const distanceFromLatest = Math.max(0, Number(cache.distance_from_latest ?? 0));
  const outputBytes = Number(cache.output_bytes ?? 0);
  const fingerprint = `buffer:${status.pid ?? ""}:${status.started_at ?? ""}:${status.last_event_id ?? ""}:${lineCount}:${distanceFromLatest}:${outputBytes}`;
  lastEventId = Number(status.last_event_id ?? lastEventId ?? 0);

  if (cacheOnly) {
    renderStatus(status);
    updateSessionIdentity(status);
    updateHistoryUi();
  } else {
    handleStatusPayload(status, { stream: true });
  }

  if (fingerprint === renderedSnapshotFingerprint) {
    return false;
  }

  unseenOutputCount = 0;
  renderedTranscriptBytes = outputBytes;
  renderedSnapshotFingerprint = fingerprint;
  term.reset();
  if (bufferText) {
    writeTerminalBytesChunked(textEncoder.encode(bufferText), () => {
      restoreTerminalViewport(distanceFromLatest);
      scheduleTerminalMirrorRefresh();
      renderTouchInputPreview(true);
      updateHistoryUi();
    });
  } else {
    restoreTerminalViewport(distanceFromLatest);
    scheduleTerminalMirrorRefresh();
    renderTouchInputPreview(true);
    updateHistoryUi();
  }
  return true;
}

function applySnapshot(snapshot, { cacheOnly = false } = {}) {
  const status = snapshot?.status;
  if (!status) {
    return false;
  }

  const outputB64 = typeof snapshot.output_b64 === "string" ? snapshot.output_b64 : "";
  const outputBytes = Number(snapshot.output_bytes ?? estimateBase64ByteLength(outputB64));
  const fingerprint = getSnapshotFingerprint(status, outputBytes);
  lastEventId = Number(status.last_event_id ?? lastEventId ?? 0);

  if (cacheOnly) {
    renderStatus(status);
    updateSessionIdentity(status);
    updateHistoryUi();
  } else {
    handleStatusPayload(status, { stream: true });
  }

  if (fingerprint === renderedSnapshotFingerprint) {
    return false;
  }

  unseenOutputCount = 0;
  renderedTranscriptBytes = outputBytes;
  renderedSnapshotFingerprint = fingerprint;
  term.reset();
  if (outputB64) {
    writeTerminalBytesChunked(base64ToBytes(outputB64), () => {
      scheduleTerminalMirrorRefresh();
      renderTouchInputPreview(true);
      updateHistoryUi();
      scheduleBufferCacheRefresh(180);
    });
  } else {
    scheduleTerminalMirrorRefresh();
    renderTouchInputPreview(true);
    updateHistoryUi();
    scheduleBufferCacheRefresh(180);
  }
  return true;
}

function restoreSnapshotCache() {
  const snapshot = readSnapshotCache();
  if (!snapshot) {
    return false;
  }
  return applySnapshot(snapshot, { cacheOnly: true });
}

function restoreBufferCache() {
  const cache = readBufferCache();
  if (!cache) {
    return false;
  }
  return applyBufferCache(cache, { cacheOnly: true });
}

function scheduleSnapshotCacheRefresh(delay = 1200) {
  if (snapshotCacheRefreshTimer || snapshotCacheRefreshInFlight) {
    return;
  }
  snapshotCacheRefreshTimer = window.setTimeout(() => {
    snapshotCacheRefreshTimer = null;
    refreshSnapshotCache();
  }, delay);
}

async function refreshSnapshotCache({ keepalive = false } = {}) {
  if (snapshotCacheRefreshInFlight) {
    return snapshotCacheRefreshInFlight;
  }

  snapshotCacheRefreshInFlight = (async () => {
    try {
      const snapshot = await fetchSnapshot({ keepalive });
      writeSnapshotCache(snapshot);
    } catch (error) {
      console.error("snapshot cache refresh failed", error);
    } finally {
      snapshotCacheRefreshInFlight = null;
    }
  })();

  return snapshotCacheRefreshInFlight;
}

function mergeChunks(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`${url} failed: ${response.status}`);
  }
  return response.json();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });
  if (!response.ok) {
    throw new Error(`${url} failed: ${response.status}`);
  }
  return response.json();
}

function markServerContact({ stream = false } = {}) {
  lastServerContactAt = Date.now();
  if (stream) {
    lastStreamContactAt = lastServerContactAt;
  }
  lastHealthcheckFailureAt = 0;
}

function updateSessionIdentity(status = {}) {
  lastSessionPid = status.pid ?? null;
  lastSessionStartedAt = status.started_at ?? null;
}

function getHistoryState() {
  const buffer = term?.buffer?.active;
  const viewportY = Math.max(0, Number(buffer?.viewportY ?? 0));
  const baseY = Math.max(0, Number(buffer?.baseY ?? 0));
  const isAtLatest = viewportY >= baseY;
  return {
    viewportY,
    baseY,
    distanceFromLatest: Math.max(0, baseY - viewportY),
    isAtTop: viewportY <= 0,
    isAtLatest,
  };
}

function updateHistoryUi() {
  const history = getHistoryState();
  const viewingHistory = !history.isAtLatest;
  const hasUnseen = unseenOutputCount > 0;

  if (historyStatus) {
    if (hasUnseen) {
      historyStatus.dataset.mode = "unseen";
      historyStatus.textContent = t("history_unseen_output", { count: unseenOutputCount });
    } else if (viewingHistory) {
      historyStatus.dataset.mode = "history";
      historyStatus.textContent = history.isAtTop
        ? t("history_top")
        : t("history_lines_up", { count: history.distanceFromLatest });
    } else {
      historyStatus.dataset.mode = "latest";
      historyStatus.textContent = t("history_latest");
    }
  }

  if (historyLatestButton) {
    historyLatestButton.disabled = history.isAtLatest && !hasUnseen;
    historyLatestButton.dataset.highlight = hasUnseen ? "true" : "false";
    historyLatestButton.textContent = hasUnseen
      ? t("history_latest_unseen", { count: unseenOutputCount })
      : t("history_latest");
  }
}

function clearUnseenOutput() {
  if (!unseenOutputCount) {
    return;
  }
  unseenOutputCount = 0;
  updateHistoryUi();
}

function scrollTerminalToLatest() {
  term.scrollToBottom();
  clearUnseenOutput();
  updateHistoryUi();
}

function scheduleFlush(delay = defaultFlushDelayMs) {
  if (flushTimer) {
    return;
  }
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    flushInput();
  }, delay);
}

function queueBytes(bytes, { urgent = false } = {}) {
  if (!bytes.length) {
    return;
  }
  pendingChunks.push(bytes);
  if (urgent) {
    if (flushTimer) {
      window.clearTimeout(flushTimer);
      flushTimer = null;
    }
    flushInput();
    return;
  }
  scheduleFlush();
}

async function flushInput() {
  if (flushInFlight || pendingChunks.length === 0) {
    return;
  }
  flushInFlight = true;
  const payload = mergeChunks(pendingChunks);
  pendingChunks = [];
  let retryScheduled = false;
  try {
    await postJson("/api/input", { data_b64: bytesToBase64(payload) });
    flushRetryDelayMs = 0;
  } catch (error) {
    console.error(error);
    pendingChunks.unshift(payload);
    flushRetryDelayMs = flushRetryDelayMs
      ? Math.min(flushRetryDelayMs * 2, 1000)
      : 120;
    setStatusMessage("status_network_jitter", "offline");
    retryScheduled = true;
    scheduleFlush(flushRetryDelayMs);
  } finally {
    flushInFlight = false;
    if (!retryScheduled && pendingChunks.length > 0) {
      flushInput();
    }
  }
}

function sendString(text, options) {
  scrollTerminalToLatest();
  queueBytes(textEncoder.encode(text), options);
}

function sendPrompt(text) {
  sendString(`${text}\r`, { urgent: true });
}

function clearTerminalTextarea() {
  if (term.textarea) {
    term.textarea.value = "";
  }
}

function clearTouchInputBridge() {
  if (touchInputBridge) {
    touchInputBridge.value = "";
    if (typeof touchInputBridge.setSelectionRange === "function") {
      touchInputBridge.setSelectionRange(0, 0);
    }
  }
  touchBridgePreviewText = "";
  renderTouchInputPreview();
}

function hideTouchInputBridgeAnchor() {
  if (!touchInputBridge) {
    return;
  }
  if (cliInputStrip) {
    touchInputBridge.style.left = "0";
    touchInputBridge.style.top = "0";
    touchInputBridge.style.width = "100%";
    touchInputBridge.style.height = "100%";
    return;
  }
  touchInputBridge.style.left = "-9999px";
  touchInputBridge.style.top = "0";
  touchInputBridge.style.width = "1px";
  touchInputBridge.style.height = "1px";
}

function syncTouchInputBridgeSelection() {
  if (
    !touchInputBridge ||
    document.activeElement !== touchInputBridge ||
    typeof touchInputBridge.setSelectionRange !== "function"
  ) {
    return;
  }
  const cursor = touchInputBridge.value.length;
  touchInputBridge.setSelectionRange(cursor, cursor);
}

function positionTouchInputBridgeAtCursor({ layoutDirty = false } = {}) {
  if (!touchInputBridge || !useTouchInputBridge) {
    return null;
  }
  if (layoutDirty) {
    invalidateTouchInputPreviewLayout();
  }
  const layout = getCachedTouchInputCursorLayout();
  if (!layout) {
    hideTouchInputBridgeAnchor();
    return null;
  }

  const bridgeChars = touchBridgeComposing ? Math.max(1, touchBridgePreviewText.length + 1) : 1;
  const bridgeWidth = Math.min(
    Math.max(layout.cellWidth, layout.cellWidth * bridgeChars),
    Math.max(layout.cellWidth, layout.stageWidth - layout.left),
  );

  touchInputBridge.style.left = `${Math.round(layout.left)}px`;
  touchInputBridge.style.top = `${Math.round(layout.top)}px`;
  touchInputBridge.style.width = `${Math.max(1, Math.round(bridgeWidth))}px`;
  touchInputBridge.style.height = `${Math.max(1, Math.round(layout.cellHeight))}px`;
  syncTouchInputBridgeSelection();
  return layout;
}

function closeOtherMenu() {
  if (otherMenu?.open) {
    otherMenu.open = false;
  }
}

function hideHistoryPanel({ restoreFocus = false } = {}) {
  if (!historyPanel || historyPanel.classList.contains("hidden")) {
    return;
  }
  historyPanel.classList.add("hidden");
  if (restoreFocus) {
    focusTerminal();
  }
}

function hideShortcutPanel({ restoreFocus = false } = {}) {
  if (!shortcutPanel || shortcutPanel.classList.contains("hidden")) {
    return;
  }
  shortcutPanel.classList.add("hidden");
  if (restoreFocus) {
    focusTerminal();
  }
}

function showHistoryPanel() {
  if (!historyPanel) {
    return;
  }
  closeOtherMenu();
  hideShortcutPanel();
  syncPlainTranscriptToUi();
  historyPanel.classList.remove("hidden");
  window.requestAnimationFrame(() => {
    if (historyLog) {
      historyLog.scrollTop = historyLog.scrollHeight;
    }
  });
}

function showShortcutPanel() {
  if (!shortcutPanel) {
    return;
  }
  closeOtherMenu();
  hideHistoryPanel();
  shortcutPanel.classList.remove("hidden");
}

function resizeComposerInput() {
  if (!composerInput) {
    return;
  }
  composerInput.style.height = "auto";
  const nextHeight = Math.min(Math.max(composerInput.scrollHeight, 44), 156);
  composerInput.style.height = `${nextHeight}px`;
}

function scheduleComposerResize() {
  if (composerResizeFrame) {
    return;
  }
  composerResizeFrame = window.requestAnimationFrame(() => {
    composerResizeFrame = 0;
    resizeComposerInput();
  });
}

function isComposerFocused() {
  return Boolean(composerInput) && document.activeElement === composerInput;
}

function isTerminalInputFocused() {
  return isComposerFocused() || document.activeElement === touchInputBridge;
}

function getViewportKeyboardInset() {
  const visualHeight = window.visualViewport?.height ?? window.innerHeight ?? 0;
  return Math.max(0, Math.round((window.innerHeight ?? visualHeight) - visualHeight));
}

function updateKeyboardLayoutState() {
  if (!document.body) {
    return false;
  }

  const keyboardInset = getViewportKeyboardInset();
  const shouldCompact =
    isTerminalInputFocused() &&
    (isMobileLikeDevice || hasCoarsePointer || useTouchInputBridge) &&
    keyboardInset > 96;

  document.body.dataset.keyboardOpen = shouldCompact ? "true" : "false";
  document.documentElement.style.setProperty(
    "--keyboard-inset",
    shouldCompact ? `${keyboardInset}px` : "0px",
  );

  if (shouldCompact) {
    hideHistoryPanel();
    hideShortcutPanel();
    window.requestAnimationFrame(() => {
      scrollContentLogToBottom();
    });
  }

  return shouldCompact;
}

function scheduleKeyboardLayoutState() {
  if (keyboardLayoutFrame) {
    return;
  }
  keyboardLayoutFrame = window.requestAnimationFrame(() => {
    keyboardLayoutFrame = 0;
    updateKeyboardLayoutState();
  });
}

function focusComposerInput({ cursorToEnd = true } = {}) {
  if (!composerInput) {
    return;
  }
  try {
    composerInput.focus({ preventScroll: true });
  } catch (error) {
    composerInput.focus();
  }
  if (cursorToEnd && typeof composerInput.setSelectionRange === "function") {
    const end = composerInput.value.length;
    composerInput.setSelectionRange(end, end);
  }
  scheduleKeyboardLayoutState();
}

function installTapAction(button, handler) {
  if (!button || typeof handler !== "function") {
    return;
  }

  const activate = () => {
    tapActionSuppressUntil = Date.now() + 450;
    handler();
  };

  button.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" || event.button !== 0) {
      return;
    }
    event.preventDefault();
    activate();
  });

  button.addEventListener("click", (event) => {
    if (Date.now() < tapActionSuppressUntil) {
      event.preventDefault();
      return;
    }
    activate();
  });
}

function clearComposerInput() {
  if (!composerInput) {
    return;
  }
  composerInput.value = "";
  resizeComposerInput();
}

function sendComposerInput() {
  if (!composerInput) {
    return;
  }
  const rawText = composerInput.value.replace(/\r\n/g, "\n");
  if (!rawText.trim()) {
    sendControlSequence("enter");
    return;
  }
  sendPrompt(rawText.trimEnd());
  clearComposerInput();
  focusComposerInput();
}

function restoreTerminalFocus() {
  window.requestAnimationFrame(() => {
    clearTerminalTextarea();
    clearTouchInputBridge();
    focusTerminal();
  });
}

function sendControlSequence(key) {
  clearTerminalTextarea();
  clearTouchInputBridge();
  sendString(specialSequences[key], { urgent: true });
  restoreTerminalFocus();
}

function sendBinaryString(text) {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    bytes[index] = text.charCodeAt(index) & 0xff;
  }
  queueBytes(bytes, { urgent: true });
}

function applyStatusState() {
  if (!statusPill || !statusText) {
    return;
  }
  if (currentStatusState.type === "key") {
    statusText.textContent = t(currentStatusState.key, currentStatusState.params);
  } else {
    statusText.textContent = currentStatusState.label;
  }
  statusPill.dataset.mode = currentStatusState.mode;
  if (commandStatusDot) {
    commandStatusDot.dataset.mode = currentStatusState.mode;
  }
}

function setStatus(label, mode) {
  currentStatusState = { type: "raw", label, mode };
  applyStatusState();
}

function setStatusMessage(key, mode, params = {}) {
  currentStatusState = { type: "key", key, params, mode };
  applyStatusState();
}

function applyLocale() {
  currentLocale = resolveLocale(currentLocale);
  document.documentElement.lang = localeDocumentLang[currentLocale];
  document.title = t("document_title");

  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    element.setAttribute("placeholder", t(element.dataset.i18nPlaceholder));
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
    element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel));
  });

  if (languageToggleButton) {
    languageToggleButton.textContent = currentLocale === "zh" ? "EN" : "中文";
    languageToggleButton.setAttribute("aria-label", t("switch_language"));
    languageToggleButton.setAttribute("title", t("switch_language"));
  }

  applyStatusState();
  syncPlainTranscriptToUi();
  updateHistoryUi();
  renderShortcutButtons();
}

function focusTouchBridgeElement() {
  try {
    touchInputBridge.focus({ preventScroll: true });
  } catch (error) {
    touchInputBridge.focus();
  }
}

function focusTerminal({ force = false } = {}) {
  clearTerminalTextarea();
  if (useTouchInputBridge) {
    const bridgeAlreadyActive = document.activeElement === touchInputBridge;
    if (!force && bridgeAlreadyActive) {
      renderTouchInputPreview();
      return;
    }
    if (!getHistoryState().isAtLatest) {
      scrollTerminalToLatest();
    }
    clearTouchInputBridge();
    hideTouchInputBridgeAnchor();
    if (force && bridgeAlreadyActive) {
      touchInputBridge.blur();
    }
    focusTouchBridgeElement();
    syncTouchInputBridgeSelection();
    renderTouchInputPreview();
    return;
  }
  if (!force && document.activeElement === term.textarea) {
    return;
  }
  term.focus();
}

function sendBackspace() {
  clearTerminalTextarea();
  clearTouchInputBridge();
  sendString("\u007f", { urgent: true });
  restoreTerminalFocus();
}

function getViewportMetrics() {
  return {
    width: Math.round(window.innerWidth),
    height: Math.round(window.innerHeight),
  };
}

function applyViewportMetrics(force = false) {
  const next = getViewportMetrics();
  if (
    !force &&
    viewportMetrics &&
    viewportMetrics.width === next.width &&
    viewportMetrics.height === next.height
  ) {
    return false;
  }

  viewportMetrics = next;
  document.documentElement.style.setProperty("--app-height", `${next.height}px`);
  return true;
}

function scheduleTerminalResize(force = false) {
  applyViewportMetrics(force);
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    resizeTimer = null;
    applyViewportMetrics(true);
    resizeTerminal();
  }, defaultResizeDelayMs);
}

function scrollTerminalHistory(direction) {
  const step = Math.max(2, Math.round(term.rows * 0.8));
  if (!step) {
    return;
  }
  term.scrollLines(direction * step);
  updateHistoryUi();
}

function stopHistoryRepeat() {
  if (historyRepeatDelayTimer) {
    window.clearTimeout(historyRepeatDelayTimer);
    historyRepeatDelayTimer = null;
  }
  if (historyRepeatInterval) {
    window.clearInterval(historyRepeatInterval);
    historyRepeatInterval = null;
  }
}

function installRepeatableHistoryButton(button, direction) {
  if (!button) {
    return;
  }

  const activate = () => {
    if (!button.disabled) {
      scrollTerminalHistory(direction);
    }
  };

  button.addEventListener("click", (event) => {
    if (Date.now() < historyRepeatSuppressClickUntil) {
      event.preventDefault();
      return;
    }
    activate();
  });

  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || button.disabled) {
      return;
    }
    event.preventDefault();
    historyRepeatSuppressClickUntil = 0;
    activate();
    stopHistoryRepeat();
    historyRepeatDelayTimer = window.setTimeout(() => {
      historyRepeatSuppressClickUntil = Date.now() + 400;
      historyRepeatInterval = window.setInterval(() => {
        activate();
      }, 110);
    }, 320);
  });

  const stop = () => {
    if (historyRepeatDelayTimer || historyRepeatInterval) {
      historyRepeatSuppressClickUntil = Date.now() + 400;
    }
    stopHistoryRepeat();
  };

  button.addEventListener("pointerup", stop);
  button.addEventListener("pointercancel", stop);
  button.addEventListener("pointerleave", stop);
}

function installHistoryButtons() {
  historyLatestButton?.addEventListener("click", () => {
    scrollTerminalToLatest();
  });
  updateHistoryUi();
}

function installTerminalInteraction() {
  if (!terminalStage) {
    return;
  }
  terminalStage.addEventListener("pointerdown", (event) => {
    terminalTapPointerId = event.pointerId;
    terminalTapMoved = false;
    terminalTapStartX = event.clientX;
    terminalTapStartY = event.clientY;
  });
  terminalStage.addEventListener("pointermove", (event) => {
    if (event.pointerId !== terminalTapPointerId) {
      return;
    }
    if (
      Math.abs(event.clientX - terminalTapStartX) > 12 ||
      Math.abs(event.clientY - terminalTapStartY) > 12
    ) {
      terminalTapMoved = true;
    }
  });
  terminalStage.addEventListener("pointerup", (event) => {
    if (event.pointerId !== terminalTapPointerId) {
      return;
    }
    const shouldFocus = !terminalTapMoved;
    terminalTapPointerId = null;
    terminalTapMoved = false;
    if (!shouldFocus) {
      return;
    }
    closeOtherMenu();
    hideHistoryPanel();
    hideShortcutPanel();
    focusTerminal();
  });
  terminalStage.addEventListener("pointercancel", () => {
    terminalTapPointerId = null;
    terminalTapMoved = false;
  });
  terminalStage.addEventListener("dblclick", () => {
    closeOtherMenu();
    hideHistoryPanel();
    hideShortcutPanel();
    focusTerminal();
  });
}

function reconcileHistoryAfterOutput(wasAtLatest) {
  if (wasAtLatest) {
    unseenOutputCount = 0;
    scrollTerminalToLatest();
    return;
  }
  unseenOutputCount = Math.min(99, unseenOutputCount + 1);
  updateHistoryUi();
}

function runSoftRecovery(reason) {
  if (document.visibilityState !== "visible") {
    return;
  }
  scheduleSessionRefresh(reason, 0);
}

function applyStateHealth(state) {
  const serverLastEventId = Number(state.last_event_id ?? 0);
  const serverQuietForMs = state.last_output_at
    ? Math.max(0, Date.now() - Math.round(Number(state.last_output_at) * 1000))
    : Infinity;
  const streamAgeMs = lastStreamContactAt ? (Date.now() - lastStreamContactAt) : Infinity;

  if (serverLastEventId > lastEventId) {
    runSoftRecovery("state-lag");
    return;
  }

  if (!eventSource || eventSource.readyState === EventSource.CLOSED) {
    runSoftRecovery("state-stream-closed");
    return;
  }

  if (streamAgeMs > 25000 && serverQuietForMs < 25000) {
    runSoftRecovery("state-stream-stale");
  }
}

function handleStatusPayload(status, { stream = false } = {}) {
  renderStatus(status);
  updateSessionIdentity(status);
  updateHistoryUi();
  markServerContact({ stream });
}

function writeTerminalOutput(dataB64) {
  const wasAtLatest = getHistoryState().isAtLatest;
  const chunkBytes = estimateBase64ByteLength(dataB64);
  term.write(base64ToBytes(dataB64), () => {
    renderedTranscriptBytes += chunkBytes;
    renderedSnapshotFingerprint = getSnapshotFingerprint(
      { pid: lastSessionPid, started_at: lastSessionStartedAt },
      renderedTranscriptBytes,
    );
    scheduleTerminalMirrorRefresh();
    renderTouchInputPreview(true);
    reconcileHistoryAfterOutput(wasAtLatest);
    scheduleSnapshotCacheRefresh();
    scheduleBufferCacheRefresh();
    appendPlainTranscriptChunk(dataB64);
  });
}

function stabilizeTerminalLayout() {
  scheduleTerminalResize(true);
  window.requestAnimationFrame(() => {
    scheduleTerminalResize(true);
  });
  window.setTimeout(() => {
    scheduleTerminalResize(true);
  }, 240);
}

function closeEventStream() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

function scheduleSessionRefresh(reason, delay = 120) {
  if (sessionRefreshInFlight) {
    return;
  }
  if (sessionRefreshTimer) {
    return;
  }
  sessionRefreshTimer = window.setTimeout(() => {
    sessionRefreshTimer = null;
    refreshSessionView(reason);
  }, delay);
}

async function refreshSessionView(reason = "resume") {
  if (sessionRefreshInFlight) {
    return sessionRefreshInFlight;
  }

  sessionRefreshInFlight = (async () => {
    try {
      closeEventStream();
      const state = await fetchJson(`/api/state?t=${Date.now()}`);
      markServerContact();

      const serverLastEventId = Number(state.last_event_id ?? 0);
      const sessionChanged =
        lastSessionPid !== null &&
        lastSessionStartedAt !== null &&
        (state.pid !== lastSessionPid || state.started_at !== lastSessionStartedAt);
      const needSnapshot =
        sessionChanged ||
        lastEventId === 0 ||
        serverLastEventId < lastEventId;

      if (needSnapshot) {
        await syncStatus();
      } else {
        handleStatusPayload(state);
      }

      connectStream();
      stabilizeTerminalLayout();
    } catch (error) {
      console.error(`session refresh failed: ${reason}`, error);
      closeEventStream();
      setStatusMessage("status_restoring", "offline");
      scheduleSessionRefresh(`${reason}-retry`, 1500);
    } finally {
      sessionRefreshInFlight = null;
    }
  })();

  return sessionRefreshInFlight;
}

async function runHealthcheck() {
  if (document.visibilityState !== "visible" || sessionRefreshInFlight) {
    return;
  }

  try {
    const state = await fetchJson(`/api/state?t=${Date.now()}`);
    markServerContact();
    applyStateHealth(state);
  } catch (error) {
    console.error("healthcheck failed", error);
    lastHealthcheckFailureAt = Date.now();
    setStatusMessage("status_connection_issue", "offline");
    scheduleSessionRefresh("healthcheck-failed", 1200);
  }
}

function startHealthchecks() {
  if (healthcheckTimer) {
    return;
  }
  healthcheckTimer = window.setInterval(() => {
    runHealthcheck();
  }, 20000);
}

function normalizeBridgeText(text) {
  return text.replace(/\u00a0/g, " ");
}

function getTouchInputCursorLayout() {
  const cell = term?._core?._renderService?.dimensions?.css?.cell;
  const buffer = term?.buffer?.active;
  const screenElement = term?.element?.querySelector(".xterm-screen");

  if (!terminalStage || !screenElement || !buffer || !cell?.width || !cell?.height) {
    return null;
  }

  const stageRect = terminalStage.getBoundingClientRect();
  const screenRect = screenElement.getBoundingClientRect();
  if (!stageRect.width || !stageRect.height || !screenRect.width || !screenRect.height) {
    return null;
  }

  const leftBase = screenRect.left - stageRect.left;
  const topBase = screenRect.top - stageRect.top;
  const cursorX = Math.max(0, Number(buffer.cursorX ?? 0));
  const cursorY = Math.max(0, Number(buffer.cursorY ?? 0));

  return {
    left: leftBase + cursorX * cell.width,
    top: topBase + cursorY * cell.height,
    leftBase,
    topBase,
    stageWidth: stageRect.width,
    stageHeight: stageRect.height,
    cellWidth: cell.width,
    cellHeight: cell.height,
  };
}

function invalidateTouchInputPreviewLayout() {
  touchBridgePreviewLayout = null;
  touchBridgePreviewLayoutDirty = true;
}

function getCachedTouchInputCursorLayout() {
  if (!touchBridgePreviewLayoutDirty && touchBridgePreviewLayout) {
    return touchBridgePreviewLayout;
  }
  touchBridgePreviewLayout = getTouchInputCursorLayout();
  touchBridgePreviewLayoutDirty = false;
  return touchBridgePreviewLayout;
}

function renderTouchInputPreviewNow() {
  if (!touchInputPreview || !touchInputPreviewValue || !useTouchInputBridge) {
    return;
  }
  const previewText = touchBridgePreviewText;
  const isFocused = touchBridgeFocused && document.activeElement === touchInputBridge;
  const shouldShow = touchBridgeComposing || previewText.length > 0;
  if (cliInputStrip) {
    cliInputStrip.dataset.focused = isFocused ? "true" : "false";
  }
  if (!shouldShow) {
    touchInputPreview.classList.remove("visible");
    hideTouchInputBridgeAnchor();
    return;
  }

  touchInputPreviewValue.textContent = previewText;
  touchInputPreview.classList.add("visible");
  touchInputPreview.dataset.focused = isFocused ? "true" : "false";
  touchInputPreview.dataset.composing = touchBridgeComposing ? "true" : "false";
  touchInputPreview.dataset.empty = previewText.length === 0 ? "true" : "false";
  hideTouchInputBridgeAnchor();
}

function scheduleTouchInputPreview(layoutDirty = false) {
  if (!useTouchInputBridge) {
    return;
  }
  if (layoutDirty) {
    invalidateTouchInputPreviewLayout();
  }
  if (touchBridgePreviewFrame) {
    return;
  }
  touchBridgePreviewFrame = window.requestAnimationFrame(() => {
    touchBridgePreviewFrame = 0;
    renderTouchInputPreviewNow();
  });
}

function renderTouchInputPreview(layoutDirty = false) {
  scheduleTouchInputPreview(layoutDirty);
}

function syncTouchInputPreview(
  previewText = normalizeBridgeText(touchInputBridge?.value || ""),
  layoutDirty = false,
) {
  touchBridgePreviewText = previewText;
  renderTouchInputPreview(layoutDirty);
}

function flushTouchInputBridge() {
  if (!useTouchInputBridge || touchBridgeComposing) {
    return false;
  }
  const value = normalizeBridgeText(touchInputBridge.value);
  if (!value) {
    return false;
  }
  sendString(value, { urgent: true });
  clearTouchInputBridge();
  return true;
}

function installTerminalTextareaRedirect() {
  if (!useTouchInputBridge || !term.textarea) {
    return;
  }

  term.textarea.readOnly = true;
  term.textarea.tabIndex = -1;
  term.textarea.setAttribute("aria-hidden", "true");
  term.textarea.addEventListener("focus", () => {
    window.requestAnimationFrame(() => {
      focusTerminal();
    });
  });
}

function installTouchInputBridge() {
  if (!useTouchInputBridge) {
    return;
  }

  touchInputBridge.classList.add("enabled");
  touchInputBridge.setAttribute("inputmode", "text");
  touchInputBridge.setAttribute("wrap", "off");
  if ("enterKeyHint" in touchInputBridge) {
    touchInputBridge.enterKeyHint = "enter";
  }
  touchInputBridge.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });
  touchInputBridge.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  renderTouchInputPreview(true);

  const keyMap = {
    Enter: "enter",
    Escape: "esc",
    Tab: "tab",
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
    Home: "home",
    End: "end",
    PageUp: "page_up",
    PageDown: "page_down",
  };

  touchInputBridge.addEventListener("compositionstart", (event) => {
    touchBridgeComposing = true;
    syncTouchInputPreview(normalizeBridgeText(event.data || touchInputBridge.value));
  });

  touchInputBridge.addEventListener("compositionupdate", (event) => {
    syncTouchInputPreview(normalizeBridgeText(event.data || touchInputBridge.value));
  });

  touchInputBridge.addEventListener("compositionend", () => {
    touchBridgeComposing = false;
    renderTouchInputPreview(true);
    window.setTimeout(() => {
      if (!flushTouchInputBridge()) {
        clearTouchInputBridge();
      }
    }, 0);
  });

  touchInputBridge.addEventListener("focus", () => {
    touchBridgeFocused = true;
    clearTouchInputBridge();
    hideTouchInputBridgeAnchor();
    renderTouchInputPreview();
    syncTouchInputBridgeSelection();
  });

  touchInputBridge.addEventListener("blur", () => {
    touchBridgeFocused = false;
    touchBridgeComposing = false;
    clearTouchInputBridge();
    hideTouchInputBridgeAnchor();
  });

  touchInputBridge.addEventListener(
    "beforeinput",
    (event) => {
      if (touchBridgeComposing) {
        syncTouchInputPreview();
        return;
      }

      if (
        event.inputType === "insertLineBreak" ||
        event.inputType === "insertParagraph" ||
        event.data === "\n"
      ) {
        event.preventDefault();
        clearTouchInputBridge();
        sendControlSequence("enter");
        return;
      }

      if (event.inputType === "deleteContentBackward" && touchInputBridge.value === "") {
        event.preventDefault();
        sendBackspace();
        return;
      }

      if (
        (event.inputType === "insertText" || event.inputType === "insertReplacementText") &&
        typeof event.data === "string" &&
        event.data.length > 0
      ) {
        event.preventDefault();
        sendString(normalizeBridgeText(event.data));
        return;
      }

      if (event.inputType === "insertFromPaste") {
        const pastedText = normalizeBridgeText(
          event.data || event.dataTransfer?.getData("text/plain") || "",
        );
        if (pastedText) {
          event.preventDefault();
          sendString(pastedText, { urgent: true });
        }
      }
    },
  );

  touchInputBridge.addEventListener(
    "keydown",
    (event) => {
      if (touchBridgeComposing) {
        return;
      }

      if (event.ctrlKey && !event.altKey && !event.metaKey) {
        const key = event.key.toLowerCase();
        if (key === "c") {
          event.preventDefault();
          sendControlSequence("ctrl_c");
          return;
        }
        if (key === "l") {
          event.preventDefault();
          sendControlSequence("ctrl_l");
          return;
        }
      }

      if (event.key === "Backspace" && touchInputBridge.value === "") {
        event.preventDefault();
        sendBackspace();
        return;
      }

      const mapped = keyMap[event.key];
      if (!mapped) {
        return;
      }

      event.preventDefault();
      sendControlSequence(mapped);
    },
  );

  touchInputBridge.addEventListener(
    "input",
    (event) => {
      if (touchBridgeComposing) {
        return;
      }
      if (event.inputType === "insertLineBreak") {
        clearTouchInputBridge();
        sendControlSequence("enter");
        return;
      }
      flushTouchInputBridge();
    },
  );
}

async function syncStatus() {
  try {
    const snapshot = await fetchSnapshot();
    writeSnapshotCache(snapshot);
    applySnapshot(snapshot);
    rebuildPlainTranscriptFromSnapshot(snapshot);
    stabilizeTerminalLayout();
  } catch (error) {
    console.error(error);
    setStatusMessage("status_service_unreachable", "offline");
    throw error;
  }
}

function formatCommandLine(parts) {
  if (!Array.isArray(parts) || parts.length === 0) {
    return "codex";
  }
  return parts.filter((part) => part !== "--search").join(" ");
}

function renderStatus(status) {
  currentSessionStatus = status ? { ...status } : null;
  if (status.running) {
    setStatusMessage("status_running", "running", { pid: status.pid });
  } else {
    const exitCode = status.exit_code;
    setStatusMessage("status_exited", "idle", {
      suffix: exitCode === null || exitCode === undefined ? "" : ` ${exitCode}`,
    });
  }
  commandLine.textContent = formatCommandLine(status.command);
  terminalSize.textContent = `${status.cols} x ${status.rows}`;
}

function connectStream() {
  closeEventStream();

  const eventUrl = lastEventId > 0
    ? `/api/events?last_id=${encodeURIComponent(lastEventId)}&t=${Date.now()}`
    : `/api/events?t=${Date.now()}`;
  const source = new EventSource(eventUrl);
  eventSource = source;

  source.onopen = () => {
    if (eventSource !== source) {
      return;
    }
    markServerContact({ stream: true });
  };

  source.addEventListener("output", (event) => {
    if (eventSource !== source) {
      return;
    }
    const payload = JSON.parse(event.data);
    lastEventId = Number(event.lastEventId || lastEventId || 0);
    writeTerminalOutput(payload.data_b64);
    markServerContact({ stream: true });
  });
  source.addEventListener("reset", (event) => {
    if (eventSource !== source) {
      return;
    }
    lastEventId = Number(event.lastEventId || lastEventId || 0);
    renderedTranscriptBytes = 0;
    renderedSnapshotFingerprint = getSnapshotFingerprint(
      { pid: lastSessionPid, started_at: lastSessionStartedAt },
      renderedTranscriptBytes,
    );
    term.reset();
    renderTouchInputPreview(true);
    unseenOutputCount = 0;
    clearSnapshotCache();
    clearBufferCache();
    resetPlainTranscript();
    scheduleSnapshotCacheRefresh(150);
    scheduleBufferCacheRefresh(150);
    markServerContact({ stream: true });
    updateHistoryUi();
    stabilizeTerminalLayout();
  });
  source.addEventListener("status", (event) => {
    if (eventSource !== source) {
      return;
    }
    const status = JSON.parse(event.data);
    lastEventId = Number(event.lastEventId || lastEventId || 0);
    handleStatusPayload(status, { stream: true });
  });
  source.onerror = () => {
    if (eventSource !== source) {
      return;
    }
    setStatusMessage("status_stream_recovering", "offline");
    scheduleSessionRefresh("stream-error", 800);
  };
}

function resizeTerminal() {
  applyViewportMetrics();
  if (!terminalElement.clientWidth || !terminalElement.clientHeight) {
    return;
  }
  const wasAtLatest = getHistoryState().isAtLatest;
  fitAddon.fit();
  if (wasAtLatest) {
    term.scrollToBottom();
  }
  const { cols, rows } = term;
  terminalSize.textContent = `${cols} x ${rows}`;
  renderTouchInputPreview(true);
  updateHistoryUi();
  scheduleBufferCacheRefresh(300);
  postJson("/api/resize", { cols, rows }).catch((error) => console.error(error));
}

term.onData((data) => {
  queueBytes(textEncoder.encode(data));
});

term.onBinary((data) => {
  sendBinaryString(data);
});

term.onRender(() => {
  scheduleTerminalMirrorRefresh();
  if (touchInputPreview?.classList.contains("visible")) {
    renderTouchInputPreview(true);
  }
});

term.onScroll(() => {
  scheduleTerminalMirrorRefresh();
  renderTouchInputPreview(true);
  if (getHistoryState().isAtLatest) {
    clearUnseenOutput();
  } else {
    updateHistoryUi();
  }
  scheduleBufferCacheRefresh(300);
});

term.onResize(({ cols, rows }) => {
  scheduleTerminalMirrorRefresh();
  terminalSize.textContent = `${cols} x ${rows}`;
  renderTouchInputPreview(true);
  updateHistoryUi();
  scheduleBufferCacheRefresh(300);
  postJson("/api/resize", { cols, rows }).catch((error) => console.error(error));
});

document.querySelectorAll("[data-send]").forEach((button) => {
  button.addEventListener("click", () => {
    const key = button.dataset.send;
    sendControlSequence(key);
    if (button.closest(".other-sheet")) {
      closeOtherMenu();
    }
  });
});

document.getElementById("focus-terminal")?.addEventListener("click", () => {
  closeOtherMenu();
  hideHistoryPanel();
  hideShortcutPanel();
  focusTerminal();
});

document.getElementById("toggle-history").addEventListener("click", () => {
  hideShortcutPanel();
  if (historyPanel?.classList.contains("hidden")) {
    showHistoryPanel();
    return;
  }
  hideHistoryPanel({ restoreFocus: true });
});

document.getElementById("toggle-shortcuts").addEventListener("click", () => {
  if (shortcutPanel?.classList.contains("hidden")) {
    showShortcutPanel();
    return;
  }
  hideShortcutPanel({ restoreFocus: true });
});

languageToggleButton?.addEventListener("click", () => {
  currentLocale = currentLocale === "zh" ? "en" : "zh";
  writeStoredLocale(currentLocale);
  applyLocale();
});

composerInput?.addEventListener("input", () => {
  scheduleComposerResize();
  scheduleKeyboardLayoutState();
});

composerInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    sendComposerInput();
  }
});

composerInput?.addEventListener("focus", () => {
  scheduleKeyboardLayoutState();
});

composerInput?.addEventListener("blur", () => {
  scheduleKeyboardLayoutState();
});

installTapAction(composerSendButton, () => {
  sendComposerInput();
});

contentLog?.addEventListener("scroll", () => {
  contentLogPinnedToLatest = isContentLogNearBottom();
});

closeHistoryButton?.addEventListener("click", () => {
  hideHistoryPanel({ restoreFocus: true });
});

closeShortcutsButton?.addEventListener("click", () => {
  hideShortcutPanel({ restoreFocus: true });
});

document.getElementById("restart-session").addEventListener("click", async () => {
  closeOtherMenu();
  setStatusMessage("status_restarting", "idle");
  try {
    await postJson("/api/restart", {});
    restoreTerminalFocus();
  } catch (error) {
    console.error(error);
    setStatusMessage("status_restart_failed", "offline");
  }
});

document.addEventListener("click", (event) => {
  if (otherMenu?.open && !otherMenu.contains(event.target)) {
    closeOtherMenu();
  }
});
window.addEventListener("resize", () => {
  if (!isTerminalInputFocused()) {
    scheduleTerminalResize();
  }
  scheduleKeyboardLayoutState();
});
window.addEventListener("load", stabilizeTerminalLayout);
window.addEventListener("pageshow", () => {
  stabilizeTerminalLayout();
  scheduleKeyboardLayoutState();
  scheduleSessionRefresh("pageshow", 80);
});
window.addEventListener("orientationchange", () => {
  stabilizeTerminalLayout();
  scheduleKeyboardLayoutState();
  scheduleSessionRefresh("orientationchange", 120);
});
window.addEventListener("focus", () => {
  scheduleKeyboardLayoutState();
  if (document.visibilityState === "visible") {
    scheduleSessionRefresh("focus", 80);
  }
});
document.addEventListener("visibilitychange", () => {
  scheduleKeyboardLayoutState();
  if (document.visibilityState === "visible") {
    stabilizeTerminalLayout();
    scheduleSessionRefresh("visibilitychange", 80);
  } else {
    refreshBufferCache();
    refreshPlainTranscriptCache();
    refreshSnapshotCache({ keepalive: true });
  }
});
window.addEventListener("pagehide", () => {
  refreshBufferCache();
  refreshPlainTranscriptCache();
  refreshSnapshotCache({ keepalive: true });
});
window.addEventListener("beforeunload", () => {
  refreshBufferCache();
  refreshPlainTranscriptCache();
  refreshSnapshotCache({ keepalive: true });
});
window.visualViewport?.addEventListener("resize", () => {
  scheduleKeyboardLayoutState();
  if (!isTerminalInputFocused()) {
    scheduleTerminalResize();
  }
});
window.visualViewport?.addEventListener("scroll", () => {
  scheduleKeyboardLayoutState();
  renderTouchInputPreview(true);
});
document.fonts?.ready?.then(() => {
  stabilizeTerminalLayout();
  scheduleSessionRefresh("fonts-ready", 80);
});

async function bootstrapApp() {
  applyViewportMetrics(true);
  installHistoryButtons();
  installTerminalTextareaRedirect();
  installTouchInputBridge();
  installTerminalInteraction();
  resizeComposerInput();
  resizeTerminal();
  restorePlainTranscriptCache();
  await loadShortcutConfig();

  const restoredFromBuffer = restoreBufferCache();
  const restoredFromSnapshot = !restoredFromBuffer && restoreSnapshotCache();
  const hasRestoredView = restoredFromBuffer || restoredFromSnapshot;

  try {
    if (!hasRestoredView) {
      await syncStatus();
    } else {
      const state = await fetchJson(`/api/state?t=${Date.now()}`);
      markServerContact();
      const sameSession =
        lastSessionPid !== null &&
        lastSessionStartedAt !== null &&
        state.pid === lastSessionPid &&
        state.started_at === lastSessionStartedAt;
      const serverLastEventId = Number(state.last_event_id ?? 0);
      const needTranscriptBootstrap = getPlainTranscriptValue().length === 0;

      if (!sameSession || serverLastEventId < lastEventId || needTranscriptBootstrap) {
        await syncStatus();
      } else {
        handleStatusPayload(state);
      }
    }
  } catch (error) {
    console.error("bootstrap sync failed", error);
    if (!hasRestoredView) {
      setStatusMessage("status_service_unreachable", "offline");
      throw error;
    }
    setStatusMessage("status_restoring", "offline");
  }

  connectStream();
  startHealthchecks();
  stabilizeTerminalLayout();
  updateKeyboardLayoutState();
}

applyLocale();

bootstrapApp().catch((error) => {
  console.error(error);
});
