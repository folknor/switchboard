import "@xterm/xterm/css/xterm.css";
import "./style.css";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import type { ITheme } from "@xterm/xterm";
import { Terminal } from "@xterm/xterm";
import morphdom from "morphdom";
import { type CMEditorView, createPlanEditor } from "./codemirror-setup";

// biome-ignore lint/suspicious/noExplicitAny: session objects from IPC have dynamic shape
type SessionObj = Record<string, any>;
// biome-ignore lint/suspicious/noExplicitAny: project objects from IPC have dynamic shape
type ProjectObj = Record<string, any>;

const statusBarInfo: HTMLElement | null =
  document.getElementById("status-bar-info");
const statusBarActivity: HTMLElement | null = document.getElementById(
  "status-bar-activity",
);
const terminalsEl: HTMLElement | null = document.getElementById("terminals");
const sidebarContent: HTMLElement | null =
  document.getElementById("sidebar-content");
const plansContent: HTMLElement | null =
  document.getElementById("plans-content");
const placeholder: HTMLElement | null = document.getElementById("placeholder");
const archiveToggle: HTMLElement | null =
  document.getElementById("archive-toggle");
const starToggle: HTMLElement | null = document.getElementById("star-toggle");
const searchInput: HTMLInputElement = document.getElementById(
  "search-input",
) as HTMLInputElement;
const terminalHeader: HTMLElement | null =
  document.getElementById("terminal-header");
const terminalHeaderName: HTMLElement | null = document.getElementById(
  "terminal-header-name",
);
const terminalHeaderId: HTMLElement | null =
  document.getElementById("terminal-header-id");
const terminalHeaderStatus: HTMLElement | null = document.getElementById(
  "terminal-header-status",
);
const terminalStopBtn: HTMLElement | null =
  document.getElementById("terminal-stop-btn");
const terminalRestartBtn: HTMLElement | null = document.getElementById(
  "terminal-restart-btn",
);
const runningToggle: HTMLElement | null =
  document.getElementById("running-toggle");
const todayToggle: HTMLElement | null = document.getElementById("today-toggle");
const planViewer: HTMLElement | null = document.getElementById("plan-viewer");
const planViewerTitle: HTMLElement | null =
  document.getElementById("plan-viewer-title");
const planViewerFilepath: HTMLElement | null = document.getElementById(
  "plan-viewer-filepath",
);
const planViewerEditorEl: HTMLElement | null =
  document.getElementById("plan-viewer-editor");
const planCopyPathBtn: HTMLElement | null =
  document.getElementById("plan-copy-path-btn");
const planCopyContentBtn: HTMLElement | null = document.getElementById(
  "plan-copy-content-btn",
);
const planSaveBtn: HTMLElement | null =
  document.getElementById("plan-save-btn");

let currentPlanContent: string = "";
let currentPlanFilePath: string = "";
let _currentPlanFilename: string = "";
let planEditorView: CMEditorView | null = null;
const loadingStatus: HTMLElement | null =
  document.getElementById("loading-status");
const sessionFilters: HTMLElement | null =
  document.getElementById("session-filters");
const searchBar: HTMLElement | null = document.getElementById("search-bar");
const statsContent: HTMLElement | null =
  document.getElementById("stats-content");
const memoryContent: HTMLElement | null =
  document.getElementById("memory-content");
const statsViewer: HTMLElement | null = document.getElementById("stats-viewer");
const statsViewerBody: HTMLElement | null =
  document.getElementById("stats-viewer-body");
const memoryViewer: HTMLElement | null =
  document.getElementById("memory-viewer");
const memoryViewerTitle: HTMLElement | null = document.getElementById(
  "memory-viewer-title",
);
const memoryViewerFilename: HTMLElement | null = document.getElementById(
  "memory-viewer-filename",
);
const memoryViewerBody: HTMLElement | null =
  document.getElementById("memory-viewer-body");
const terminalArea: HTMLElement | null =
  document.getElementById("terminal-area");
const settingsViewer: HTMLElement | null =
  document.getElementById("settings-viewer");
const settingsViewerTitle: HTMLElement | null = document.getElementById(
  "settings-viewer-title",
);
const settingsViewerBody: HTMLElement | null = document.getElementById(
  "settings-viewer-body",
);
const globalSettingsBtn: HTMLElement | null = document.getElementById(
  "global-settings-btn",
);
const addProjectBtn: HTMLElement | null =
  document.getElementById("add-project-btn");
const jsonlViewer: HTMLElement | null = document.getElementById("jsonl-viewer");
const jsonlViewerTitle: HTMLElement | null =
  document.getElementById("jsonl-viewer-title");
const jsonlViewerSessionId: HTMLElement | null = document.getElementById(
  "jsonl-viewer-session-id",
);
const jsonlViewerBody: HTMLElement | null =
  document.getElementById("jsonl-viewer-body");

// Map<sessionId, { terminal, element, fitAddon, session, closed }>
// biome-ignore lint/suspicious/noExplicitAny: dynamic session entry shape
const openSessions: Map<string, any> = new Map();
let activeSessionId: string | null =
  sessionStorage.getItem("activeSessionId") || null;
function setActiveSession(id: string | null): void {
  activeSessionId = id;
  if (id) sessionStorage.setItem("activeSessionId", id);
  else sessionStorage.removeItem("activeSessionId");
}
// Persist slug group expand state across reloads
function getExpandedSlugs(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem("expandedSlugs") || "[]"));
  } catch {
    return new Set();
  }
}
function saveExpandedSlugs(): void {
  const expanded: string[] = [];
  for (const g of document.querySelectorAll(".slug-group:not(.collapsed)")) {
    if (g.id) expanded.push(g.id);
  }
  sessionStorage.setItem("expandedSlugs", JSON.stringify(expanded));
}
let showArchived: boolean = false;
let showStarredOnly: boolean = false;
let showRunningOnly: boolean = false;
let showTodayOnly: boolean = false;
let cachedProjects: ProjectObj[] = [];
let cachedAllProjects: ProjectObj[] = [];
let activePtyIds: Set<string> = new Set();
let activeTab: string = "sessions";
let cachedPlans: ProjectObj[] = [];
let visibleSessionCount: number = 10;
let sessionMaxAgeDays: number = 3;
// biome-ignore lint/suspicious/noExplicitAny: dynamic pending session shape
const pendingSessions: Map<string, any> = new Map(); // sessionId → { session, projectPath, folder }

// --- Activity tracking ---
const unreadSessions: Set<string> = new Set(); // sessions with unseen output
const attentionSessions: Set<string> = new Set(); // sessions needing user action
const lastActivityTime: Map<string, Date> = new Map(); // sessionId → Date of last terminal output

// Noise patterns to ignore for unread tracking
const unreadNoiseRe: RegExp = /file-history-snapshot|^\s*$/;

function markUnread(sessionId: string, data: string): void {
  if (sessionId === activeSessionId) return;
  // Skip noise
  if (unreadNoiseRe.test(data)) return;
  if (!unreadSessions.has(sessionId)) {
    unreadSessions.add(sessionId);
    const item: Element | null = document.querySelector(
      `.session-item[data-session-id="${sessionId}"]`,
    );
    if (item) item.classList.add("has-unread");
  }
}

function clearUnread(sessionId: string): void {
  unreadSessions.delete(sessionId);
  const item: Element | null = document.querySelector(
    `.session-item[data-session-id="${sessionId}"]`,
  );
  if (item) item.classList.remove("has-unread");
}

// --- Terminal themes ---
const TERMINAL_THEMES = {
  switchboard: {
    label: "Switchboard",
    background: "#1a1a2e",
    foreground: "#e0e0e0",
    cursor: "#e94560",
    selectionBackground: "#3a3a5e",
    black: "#1a1a2e",
    red: "#e94560",
    green: "#0dff00",
    yellow: "#f5a623",
    blue: "#7b68ee",
    magenta: "#c678dd",
    cyan: "#56b6c2",
    white: "#c5c8c6",
    brightBlack: "#555568",
    brightRed: "#ff6b81",
    brightGreen: "#69ff69",
    brightYellow: "#ffd93d",
    brightBlue: "#8fa8ff",
    brightMagenta: "#d19afc",
    brightCyan: "#7ee8e8",
    brightWhite: "#eaeaea",
  },
  ghostty: {
    label: "Ghostty",
    background: "#292c33",
    foreground: "#ffffff",
    cursor: "#ffffff",
    cursorAccent: "#363a43",
    selectionBackground: "#ffffff",
    selectionForeground: "#292c33",
    black: "#1d1f21",
    red: "#bf6b69",
    green: "#b7bd73",
    yellow: "#e9c880",
    blue: "#88a1bb",
    magenta: "#ad95b8",
    cyan: "#95bdb7",
    white: "#c5c8c6",
    brightBlack: "#666666",
    brightRed: "#c55757",
    brightGreen: "#bcc95f",
    brightYellow: "#e1c65e",
    brightBlue: "#83a5d6",
    brightMagenta: "#bc99d4",
    brightCyan: "#83beb1",
    brightWhite: "#eaeaea",
  },
  tokyoNight: {
    label: "Tokyo Night",
    background: "#1a1b26",
    foreground: "#c0caf5",
    cursor: "#c0caf5",
    selectionBackground: "#33467c",
    black: "#15161e",
    red: "#f7768e",
    green: "#9ece6a",
    yellow: "#e0af68",
    blue: "#7aa2f7",
    magenta: "#bb9af7",
    cyan: "#7dcfff",
    white: "#a9b1d6",
    brightBlack: "#414868",
    brightRed: "#f7768e",
    brightGreen: "#9ece6a",
    brightYellow: "#e0af68",
    brightBlue: "#7aa2f7",
    brightMagenta: "#bb9af7",
    brightCyan: "#7dcfff",
    brightWhite: "#c0caf5",
  },
  catppuccinMocha: {
    label: "Catppuccin Mocha",
    background: "#1e1e2e",
    foreground: "#cdd6f4",
    cursor: "#f5e0dc",
    selectionBackground: "#45475a",
    black: "#45475a",
    red: "#f38ba8",
    green: "#a6e3a1",
    yellow: "#f9e2af",
    blue: "#89b4fa",
    magenta: "#f5c2e7",
    cyan: "#94e2d5",
    white: "#bac2de",
    brightBlack: "#585b70",
    brightRed: "#f38ba8",
    brightGreen: "#a6e3a1",
    brightYellow: "#f9e2af",
    brightBlue: "#89b4fa",
    brightMagenta: "#f5c2e7",
    brightCyan: "#94e2d5",
    brightWhite: "#a6adc8",
  },
  dracula: {
    label: "Dracula",
    background: "#282a36",
    foreground: "#f8f8f2",
    cursor: "#f8f8f2",
    selectionBackground: "#44475a",
    black: "#21222c",
    red: "#ff5555",
    green: "#50fa7b",
    yellow: "#f1fa8c",
    blue: "#bd93f9",
    magenta: "#ff79c6",
    cyan: "#8be9fd",
    white: "#f8f8f2",
    brightBlack: "#6272a4",
    brightRed: "#ff6e6e",
    brightGreen: "#69ff94",
    brightYellow: "#ffffa5",
    brightBlue: "#d6acff",
    brightMagenta: "#ff92df",
    brightCyan: "#a4ffff",
    brightWhite: "#ffffff",
  },
  nord: {
    label: "Nord",
    background: "#2e3440",
    foreground: "#d8dee9",
    cursor: "#d8dee9",
    selectionBackground: "#434c5e",
    black: "#3b4252",
    red: "#bf616a",
    green: "#a3be8c",
    yellow: "#ebcb8b",
    blue: "#81a1c1",
    magenta: "#b48ead",
    cyan: "#88c0d0",
    white: "#e5e9f0",
    brightBlack: "#4c566a",
    brightRed: "#bf616a",
    brightGreen: "#a3be8c",
    brightYellow: "#ebcb8b",
    brightBlue: "#81a1c1",
    brightMagenta: "#b48ead",
    brightCyan: "#8fbcbb",
    brightWhite: "#eceff4",
  },
  solarizedDark: {
    label: "Solarized Dark",
    background: "#002b36",
    foreground: "#839496",
    cursor: "#839496",
    selectionBackground: "#073642",
    black: "#073642",
    red: "#dc322f",
    green: "#859900",
    yellow: "#b58900",
    blue: "#268bd2",
    magenta: "#d33682",
    cyan: "#2aa198",
    white: "#eee8d5",
    brightBlack: "#002b36",
    brightRed: "#cb4b16",
    brightGreen: "#586e75",
    brightYellow: "#657b83",
    brightBlue: "#839496",
    brightMagenta: "#6c71c4",
    brightCyan: "#93a1a1",
    brightWhite: "#fdf6e3",
  },
};

let currentThemeName: string = "switchboard";
function getTerminalTheme(): ITheme {
  return TERMINAL_THEMES[currentThemeName] || TERMINAL_THEMES.switchboard;
}
let TERMINAL_THEME: ITheme = getTerminalTheme();

// --- Terminal key handler: send modifier+key combos as kitty protocol sequences ---
function attachTerminalKeyHandler(
  terminal: Terminal,
  getSessionId: () => string,
): void {
  terminal.attachCustomKeyEventHandler((e) => {
    // Shift+Enter → kitty protocol: CSI 13 ; 2 u
    // Must return false for ALL event types (keydown, keypress, keyup) to prevent
    // the keypress handler from also sending \r through onData
    if (
      e.key === "Enter" &&
      e.shiftKey &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.metaKey
    ) {
      if (e.type === "keydown") {
        window.api.sendInput(getSessionId(), "\x1b[13;2u");
      }
      return false;
    }
    return true;
  });
}

// --- IPC listeners from main process ---
// Synchronized output markers — TUI repaints, not meaningful content
const ESC_SYNC_START = "\x1b[?2026h";
const ESC_SYNC_END = "\x1b[?2026l";

// Terminal escape sequences
const ESC_SCREEN_CLEAR = "\x1b[2J";
const ESC_ALT_SCREEN_ON = "\x1b[?1049h";

// Scroll-to-bottom window: activated by resize or large redraws,
// then write callbacks keep scrolling until the window expires.
let redrawScrollActive: ReturnType<typeof setTimeout> | null = null;

window.api.onTerminalData((sessionId, data) => {
  const entry = openSessions.get(sessionId);
  if (entry) {
    // Detect full redraws and activate scroll window (same approach as resize)
    // Only scan for escape sequences in chunks that contain ESC[
    if (
      sessionId === activeSessionId &&
      data.length > 3 &&
      data.includes("\x1b[")
    ) {
      if (data.includes(ESC_SCREEN_CLEAR) || data.includes(ESC_ALT_SCREEN_ON)) {
        clearTimeout(redrawScrollActive);
        redrawScrollActive = setTimeout(() => {
          redrawScrollActive = null;
        }, 1000);
      }
    }

    entry.terminal.write(data, () => {
      if (sessionId !== activeSessionId) return;
      if (resizeScrollActive !== null || redrawScrollActive !== null) {
        setTimeout(() => entry.terminal.scrollToBottom(), 50);
        if (resizeScrollActive !== null) {
          clearTimeout(resizeScrollActive);
          resizeScrollActive = setTimeout(() => {
            resizeScrollActive = null;
          }, 300);
        }
        if (redrawScrollActive !== null) {
          clearTimeout(redrawScrollActive);
          redrawScrollActive = setTimeout(() => {
            redrawScrollActive = null;
          }, 1000);
        }
      }
    });
  }
  // Don't mark activity for synchronized output (TUI repaints)
  const isSyncRedraw =
    data.startsWith(ESC_SYNC_START) && data.endsWith(ESC_SYNC_END);
  if (!isSyncRedraw) {
    if (!unreadNoiseRe.test(data)) lastActivityTime.set(sessionId, new Date());
    markUnread(sessionId, data);
  }
});

window.api.onSessionDetected((tempId, realId) => {
  const entry = openSessions.get(tempId);
  if (!entry) return;

  entry.session.sessionId = realId;
  if (activeSessionId === tempId) setActiveSession(realId);

  // Re-key in openSessions
  openSessions.delete(tempId);
  openSessions.set(realId, entry);

  terminalHeaderId.textContent = realId;
  terminalHeaderName.textContent = "New session";

  // Refresh sidebar to show the new session, then select it
  void loadProjects().then(() => {
    const item: Element | null = document.querySelector(
      `[data-session-id="${realId}"]`,
    );
    if (item) {
      for (const el of document.querySelectorAll(".session-item.active")) {
        el.classList.remove("active");
      }
      item.classList.add("active");
    }
  });
  void pollActiveSessions();
});

window.api.onSessionForked((oldId, newId) => {
  const entry = openSessions.get(oldId);
  if (!entry) return;

  entry.session.sessionId = newId;
  if (activeSessionId === oldId) setActiveSession(newId);

  openSessions.delete(oldId);
  openSessions.set(newId, entry);

  // Clean up pending session so it doesn't duplicate the real .jsonl entry
  pendingSessions.delete(oldId);
  sessionMap.delete(oldId);
  sessionMap.set(newId, entry.session);

  terminalHeaderId.textContent = newId;

  void loadProjects().then(() => {
    const item: Element | null = document.querySelector(
      `[data-session-id="${newId}"]`,
    );
    if (item) {
      for (const el of document.querySelectorAll(".session-item.active")) {
        el.classList.remove("active");
      }
      item.classList.add("active");
      const summary: Element | null = item.querySelector(".session-summary");
      if (summary) terminalHeaderName.textContent = summary.textContent;
    }
  });
  void pollActiveSessions();
});

window.api.onProcessExited((sessionId, _exitCode) => {
  const entry = openSessions.get(sessionId);
  const session = sessionMap.get(sessionId);
  if (entry) {
    entry.closed = true;
  }

  // Clean up terminal UI on exit
  if (entry) {
    window.api.closeTerminal(sessionId);
    entry.terminal.dispose();
    entry.element.remove();
    openSessions.delete(sessionId);
  }
  if (activeSessionId === sessionId) {
    setActiveSession(null);
    terminalHeader.style.display = "none";
    placeholder.style.display = "";
  }

  // Plain terminal sessions: remove from sidebar entirely (ephemeral)
  if (session?.type === "terminal") {
    pendingSessions.delete(sessionId);
    for (const projList of [cachedProjects, cachedAllProjects]) {
      for (const proj of projList) {
        proj.sessions = proj.sessions.filter((s) => s.sessionId !== sessionId);
      }
    }
    sessionMap.delete(sessionId);
    renderProjects(showArchived ? cachedAllProjects : cachedProjects);
    void pollActiveSessions();
    return;
  }

  // Clean up no-op pending sessions (never created a .jsonl)
  if (pendingSessions.has(sessionId)) {
    pendingSessions.delete(sessionId);
    // Remove from cached project data
    for (const projList of [cachedProjects, cachedAllProjects]) {
      for (const proj of projList) {
        proj.sessions = proj.sessions.filter(
          (s: SessionObj) => s.sessionId !== sessionId,
        );
      }
    }
    sessionMap.delete(sessionId);
    renderProjects(showArchived ? cachedAllProjects : cachedProjects);
  }

  void pollActiveSessions();
});

// --- Terminal notifications (iTerm2 OSC 9 — "needs attention") ---
window.api.onTerminalNotification((sessionId, message) => {
  // Only mark as needing attention for "attention" messages, not "waiting for input"
  if (
    /attention|approval|permission|needs your/i.test(message) &&
    sessionId !== activeSessionId
  ) {
    attentionSessions.add(sessionId);
    const item = document.querySelector(
      `.session-item[data-session-id="${sessionId}"]`,
    );
    if (item) item.classList.add("needs-attention");
  }

  // Show in header if active
  if (sessionId === activeSessionId && terminalHeaderPtyTitle) {
    terminalHeaderPtyTitle.textContent = message;
    terminalHeaderPtyTitle.style.display = "";
  }
});

// --- Progress state (iTerm2 OSC 9;4) ---
// state: 0=clear, 1=progress%, 2=error, 3=indeterminate(busy), 4=warning
const sessionProgressState: Map<string, { state: number; percent: number }> =
  new Map();

window.api.onProgressState((sessionId, state, percent) => {
  sessionProgressState.set(sessionId, { state, percent });
  updateProgressIndicators(sessionId);
});

function updateProgressIndicators(sessionId: string): void {
  const info = sessionProgressState.get(sessionId);
  const state = info?.state ?? 0;

  // Update sidebar item
  const item = document.querySelector(
    `.session-item[data-session-id="${sessionId}"]`,
  );
  if (item) {
    item.classList.toggle("is-busy", state === 3);
    item.classList.toggle("has-progress", state === 1);
    item.classList.toggle("has-error", state === 2);
  }

  // Update terminal header progress bar if this is the active session
  if (sessionId === activeSessionId) {
    const bar = document.getElementById("terminal-progress-bar");
    if (!bar) return;
    bar.className = `progress-state-${state}`;
    if (state === 1) {
      bar.style.setProperty("--progress", `${info?.percent || 0}%`);
    }
  }
}

// --- Filter toggle helpers ---
function resetSortDebouncing(): void {
  sortSnapshot.clear();
  lastProjectSortTime = 0;
}

// --- Archive toggle ---
archiveToggle.addEventListener("click", () => {
  showArchived = !showArchived;
  archiveToggle.classList.toggle("active", showArchived);
  resetSortDebouncing();
  renderProjects(showArchived ? cachedAllProjects : cachedProjects);
});

// --- Star filter toggle ---
starToggle.addEventListener("click", () => {
  showStarredOnly = !showStarredOnly;
  if (showStarredOnly) {
    showRunningOnly = false;
    runningToggle.classList.remove("active");
  }
  starToggle.classList.toggle("active", showStarredOnly);
  resetSortDebouncing();
  renderProjects(showArchived ? cachedAllProjects : cachedProjects);
});

// --- Running filter toggle ---
runningToggle.addEventListener("click", () => {
  showRunningOnly = !showRunningOnly;
  if (showRunningOnly) {
    showStarredOnly = false;
    starToggle.classList.remove("active");
  }
  runningToggle.classList.toggle("active", showRunningOnly);
  resetSortDebouncing();
  renderProjects(showArchived ? cachedAllProjects : cachedProjects);
});

// --- Today filter toggle ---
todayToggle.addEventListener("click", () => {
  showTodayOnly = !showTodayOnly;
  todayToggle.classList.toggle("active", showTodayOnly);
  resetSortDebouncing();
  renderProjects(showArchived ? cachedAllProjects : cachedProjects);
});

// --- Search (debounced, per-tab FTS) ---
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const searchClear: HTMLElement | null = document.getElementById("search-clear");

function clearSearch(): void {
  searchInput.value = "";
  searchBar.classList.remove("has-query");
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }
  if (activeTab === "sessions") {
    renderProjects(showArchived ? cachedAllProjects : cachedProjects);
  } else if (activeTab === "plans") {
    renderPlans(cachedPlans);
  } else if (activeTab === "memory") {
    renderMemories(cachedMemories);
  }
}

searchClear.addEventListener("click", () => {
  clearSearch();
  searchInput.focus();
});

searchInput.addEventListener("input", () => {
  // Toggle clear button visibility
  searchBar.classList.toggle("has-query", searchInput.value.length > 0);

  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(async () => {
    searchDebounceTimer = null;
    const query = searchInput.value.trim();

    if (!query) {
      clearSearch();
      return;
    }

    try {
      if (activeTab === "sessions") {
        const results = await window.api.search("session", query);
        const matchIds = new Set(results.map((r) => r.id));
        // Always search all projects (including archived) so no results are hidden
        const filtered = cachedAllProjects
          .map((p) => ({
            ...p,
            sessions: p.sessions.filter((s) => matchIds.has(s.sessionId)),
          }))
          .filter((p) => p.sessions.length > 0);
        renderProjects(filtered, true);
      } else if (activeTab === "plans") {
        const results = await window.api.search("plan", query);
        const matchIds = new Set(results.map((r) => r.id));
        renderPlans(cachedPlans.filter((p) => matchIds.has(p.filename)));
      } else if (activeTab === "memory") {
        const results = await window.api.search("memory", query);
        const matchIds = new Set(results.map((r) => r.id));
        renderMemories(cachedMemories.filter((m) => matchIds.has(m.filePath)));
      }
    } catch {
      // Fallback to showing all on error
      if (activeTab === "sessions") {
        renderProjects(showArchived ? cachedAllProjects : cachedProjects);
      }
    }
  }, 200);
});

// --- Terminal header controls ---
terminalStopBtn.addEventListener("click", async () => {
  if (!activeSessionId) return;
  const sid = activeSessionId;
  await window.api.stopSession(sid);
  activePtyIds.delete(sid);
  setActiveSession(null);
  terminalHeader.style.display = "none";
  placeholder.style.display = "";
  renderProjects(showArchived ? cachedAllProjects : cachedProjects);
});

terminalRestartBtn.addEventListener("click", () => {
  if (!activeSessionId) return;
  const entry = openSessions.get(activeSessionId);
  if (!entry) return;
  window.api.closeTerminal(activeSessionId);
  entry.terminal.dispose();
  entry.element.remove();
  openSessions.delete(activeSessionId);
  void openSession(entry.session);
});

// --- Poll for active PTY sessions ---
async function pollActiveSessions(): Promise<void> {
  try {
    const ids: string[] = await window.api.getActiveSessions();
    activePtyIds = new Set(ids);
    updateRunningIndicators();
    updateTerminalHeader();
  } catch {}
}

function updateRunningIndicators(): void {
  for (const item of document.querySelectorAll(".session-item")) {
    const id: string | undefined = (item as HTMLElement).dataset.sessionId;
    const running: boolean = id ? activePtyIds.has(id) : false;
    item.classList.toggle("has-running-pty", running);
    if (!running) {
      item.classList.remove(
        "has-unread",
        "needs-attention",
        "is-busy",
        "has-progress",
        "has-error",
      );
      if (id) {
        unreadSessions.delete(id);
        attentionSessions.delete(id);
        sessionProgressState.delete(id);
      }
    }
    const dot: Element | null = item.querySelector(".session-status-dot");
    if (dot) dot.classList.toggle("running", running);
  }
  // Update slug group running dots
  for (const group of document.querySelectorAll(".slug-group")) {
    const hasRunning: boolean =
      group.querySelector(".session-item.has-running-pty") !== null;
    const dot: Element | null = group.querySelector(".slug-group-dot");
    if (dot) dot.classList.toggle("running", hasRunning);
  }
}

function updateTerminalHeader(): void {
  if (!activeSessionId) return;
  const running = activePtyIds.has(activeSessionId);
  terminalHeaderStatus.className = running ? "running" : "stopped";
  terminalHeaderStatus.textContent = running ? "Running" : "Stopped";
  terminalStopBtn.style.display = running ? "" : "none";
  updatePtyTitle();
}

const terminalHeaderPtyTitle: HTMLElement | null = document.getElementById(
  "terminal-header-pty-title",
);

function updatePtyTitle(): void {
  if (!(activeSessionId && terminalHeaderPtyTitle)) return;
  const entry = openSessions.get(activeSessionId);
  const title = entry?.ptyTitle || "";
  terminalHeaderPtyTitle.textContent = title;
  terminalHeaderPtyTitle.style.display = title ? "" : "none";
}

setInterval(pollActiveSessions, 3000);

// Refresh sidebar timeago labels every 30s so "just now" ticks forward
setInterval(() => {
  for (const [sessionId, time] of lastActivityTime) {
    const item = document.getElementById(`si-${sessionId}`);
    if (!item) continue;
    const meta = item.querySelector(".session-meta");
    if (!meta) continue;
    const session = sessionMap.get(sessionId);
    const msgSuffix = session?.messageCount
      ? ` \u00b7 ${session.messageCount} msgs`
      : "";
    meta.textContent = formatDate(time) + msgSuffix;
  }
}, 30000);

// Shared session map so all caches reference the same objects
const sessionMap: Map<string, SessionObj> = new Map();

function dedup(projects: ProjectObj[]): void {
  for (const p of projects) {
    for (let i = 0; i < p.sessions.length; i++) {
      const s = p.sessions[i];
      if (sessionMap.has(s.sessionId)) {
        Object.assign(sessionMap.get(s.sessionId), s);
        p.sessions[i] = sessionMap.get(s.sessionId);
      } else {
        sessionMap.set(s.sessionId, s);
      }
    }
  }
}

async function loadProjects(): Promise<void> {
  const wasEmpty = cachedProjects.length === 0;
  if (wasEmpty) {
    loadingStatus.textContent = "Loading\u2026";
    loadingStatus.className = "active";
    loadingStatus.style.display = "";
  }
  const [defaultProjects, allProjects] = await Promise.all([
    window.api.getProjects(false),
    window.api.getProjects(true),
  ]);
  cachedProjects = defaultProjects;
  cachedAllProjects = allProjects;
  loadingStatus.style.display = "none";
  loadingStatus.className = "";
  dedup(cachedProjects);
  dedup(cachedAllProjects);

  // Reconcile pending sessions: remove ones that now have real data
  let _hasReinjected = false;
  for (const [sid, pending] of [...pendingSessions]) {
    const realExists = allProjects.some((p) =>
      p.sessions.some((s) => s.sessionId === sid),
    );
    if (realExists) {
      pendingSessions.delete(sid);
    } else {
      _hasReinjected = true;
      // Still pending — re-inject into cached data
      for (const projList of [cachedProjects, cachedAllProjects]) {
        let proj = projList.find((p) => p.projectPath === pending.projectPath);
        if (!proj) {
          // Project not in list (no other sessions) — create a synthetic entry
          proj = {
            folder: pending.folder,
            projectPath: pending.projectPath,
            sessions: [],
          };
          projList.unshift(proj);
        }
        if (!proj.sessions.some((s) => s.sessionId === sid)) {
          proj.sessions.unshift(pending.session);
        }
      }
    }
  }

  // Restore active plain terminals from main process (survives renderer reload)
  try {
    const activeTerminals = await window.api.getActiveTerminals();
    for (const { sessionId, projectPath } of activeTerminals) {
      if (pendingSessions.has(sessionId)) continue; // already tracked
      const folder = projectPath.replace(/[/_]/g, "-").replace(/^-/, "-");
      const session = {
        sessionId,
        summary: "Terminal",
        firstPrompt: "",
        projectPath,
        name: null,
        starred: 0,
        archived: 0,
        messageCount: 0,
        modified: new Date().toISOString(),
        created: new Date().toISOString(),
        type: "terminal",
      };
      pendingSessions.set(sessionId, { session, projectPath, folder });
      sessionMap.set(sessionId, session);
      for (const projList of [cachedProjects, cachedAllProjects]) {
        let proj = projList.find((p) => p.projectPath === projectPath);
        if (!proj) {
          proj = { folder, projectPath, sessions: [] };
          projList.push(proj);
        }
        if (!proj.sessions.some((s) => s.sessionId === sessionId)) {
          proj.sessions.unshift(session);
        }
      }
    }
  } catch {}

  await pollActiveSessions();
  renderProjects(showArchived ? cachedAllProjects : cachedProjects);
  renderDefaultStatus();
}

function slugId(slug: string): string {
  return `slug-${slug.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function folderId(projectPath: string): string {
  return `project-${projectPath.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function buildSlugGroup(slug: string, sessions: SessionObj[]): HTMLDivElement {
  const group = document.createElement("div");
  const id = slugId(slug);
  const expanded = getExpandedSlugs().has(id);
  group.className = expanded ? "slug-group" : "slug-group collapsed";
  group.id = id;

  const mostRecent = sessions.reduce((a, b) => {
    const aTime = lastActivityTime.get(a.sessionId) || new Date(a.modified);
    const bTime = lastActivityTime.get(b.sessionId) || new Date(b.modified);
    return bTime > aTime ? b : a;
  });
  const displayName = cleanDisplayName(
    mostRecent.name || mostRecent.summary || slug,
  );
  const mostRecentTime =
    lastActivityTime.get(mostRecent.sessionId) || new Date(mostRecent.modified);
  const timeStr = formatDate(mostRecentTime);

  const header = document.createElement("div");
  header.className = "slug-group-header";

  const row = document.createElement("div");
  row.className = "slug-group-row";

  const expand = document.createElement("span");
  expand.className = "slug-group-expand";
  expand.innerHTML = '<span class="arrow">&#9654;</span>';

  const info = document.createElement("div");
  info.className = "slug-group-info";

  const nameEl = document.createElement("div");
  nameEl.className = "slug-group-name";
  nameEl.textContent = displayName;

  const hasRunning = sessions.some((s) => activePtyIds.has(s.sessionId));

  const meta = document.createElement("div");
  meta.className = "slug-group-meta";
  meta.innerHTML = `<span class="slug-group-dot${hasRunning ? " running" : ""}"></span><span class="slug-group-count">${sessions.length} sessions</span> ${escapeHtml(timeStr)}`;

  const archiveSlugBtn = document.createElement("button");
  archiveSlugBtn.className = "slug-group-archive-btn";
  archiveSlugBtn.title = "Archive all sessions in group";
  archiveSlugBtn.innerHTML =
    '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1,1 L11,1 L11,4 L1,4 Z"/><path d="M1,4 L1,11 L11,11 L11,4"/><line x1="5" y1="6.5" x2="7" y2="6.5"/></svg>';

  info.appendChild(nameEl);
  info.appendChild(meta);
  row.appendChild(expand);
  row.appendChild(info);
  row.appendChild(archiveSlugBtn);
  header.appendChild(row);

  const sessionsContainer = document.createElement("div");
  sessionsContainer.className = "slug-group-sessions";

  const promoted: SessionObj[] = [];
  const rest: SessionObj[] = [];
  for (const session of sessions) {
    if (activePtyIds.has(session.sessionId)) {
      promoted.push(session);
    } else {
      rest.push(session);
    }
  }

  if (promoted.length > 0) {
    group.classList.add("has-promoted");
    for (const session of promoted) {
      sessionsContainer.appendChild(buildSessionItem(session));
    }
    if (rest.length > 0) {
      const moreBtn = document.createElement("div");
      moreBtn.className = "slug-group-more";
      moreBtn.id = `sgm-${id}`;
      moreBtn.textContent = `+ ${rest.length} more`;

      const olderDiv = document.createElement("div");
      olderDiv.className = "slug-group-older";
      olderDiv.id = `sgo-${id}`;
      for (const session of rest) {
        olderDiv.appendChild(buildSessionItem(session));
      }

      sessionsContainer.appendChild(moreBtn);
      sessionsContainer.appendChild(olderDiv);
    }
  } else {
    for (const session of sessions) {
      sessionsContainer.appendChild(buildSessionItem(session));
    }
  }

  group.appendChild(header);
  group.appendChild(sessionsContainer);
  return group;
}

// Sort debouncing: preserve order when timestamps change by small amounts (background refreshes).
// Only re-sort an item when its timestamp jumps significantly (e.g. user opened an old session).
// Snapshot stores the sortTime actually used, so small drifts accumulate and eventually trigger resort.
const sortSnapshot: Map<string, number> = new Map(); // itemId → sortTime used in last render
const SORT_DRIFT_THRESHOLD: number = 5 * 60 * 1000; // 5 minutes
let lastProjectSortTime: number = 0; // timestamp of last project group re-sort

let lastRenderWasSearch: boolean = false;
function renderProjects(
  projects: ProjectObj[],
  isSearchResult?: boolean,
): void {
  const newSidebar = document.createElement("div");

  // Debounce project group re-sorting: only re-sort if >5 min since last sort
  const now = Date.now();
  if (now - lastProjectSortTime > SORT_DRIFT_THRESHOLD || lastRenderWasSearch) {
    lastProjectSortTime = now;
    // projects arrive pre-sorted from main process — accept new order
  } else if (!isSearchResult && sidebarContent.children.length > 0) {
    // Preserve current project group order
    const existingOrder = new Map();
    let idx = 0;
    for (const child of sidebarContent.children) {
      if (child.id) existingOrder.set(child.id, idx++);
    }
    projects = [...projects].sort((a, b) => {
      const aIdx = existingOrder.get(folderId(a.projectPath));
      const bIdx = existingOrder.get(folderId(b.projectPath));
      if (aIdx !== undefined && bIdx !== undefined) return aIdx - bIdx;
      if (aIdx === undefined) return -1; // new projects go to top
      if (bIdx === undefined) return -1;
      return 0;
    });
  }

  for (const project of projects) {
    // === STEP 1: Filter ===
    let filtered = project.sessions;
    if (showStarredOnly) {
      filtered = filtered.filter((s) => s.starred);
    }
    if (showRunningOnly) {
      filtered = filtered.filter((s) => activePtyIds.has(s.sessionId));
    }
    if (showTodayOnly) {
      const todayDate = new Date();
      const todayStr = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, "0")}-${String(todayDate.getDate()).padStart(2, "0")}`;
      filtered = filtered.filter((s: SessionObj) => {
        if (!s.modified) return false;
        const d = new Date(s.modified);
        return (
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` ===
          todayStr
        );
      });
    }
    if (filtered.length === 0 && project.sessions.length > 0) continue;

    // === STEP 2: Sort ===
    // Priority: pinned+running > running > pinned > rest (by modified desc)
    filtered = [...filtered].sort((a, b) => {
      const aRunning =
        activePtyIds.has(a.sessionId) || pendingSessions.has(a.sessionId);
      const bRunning =
        activePtyIds.has(b.sessionId) || pendingSessions.has(b.sessionId);
      const aPri = a.starred && aRunning ? 3 : aRunning ? 2 : a.starred ? 1 : 0;
      const bPri = b.starred && bRunning ? 3 : bRunning ? 2 : b.starred ? 1 : 0;
      if (aPri !== bPri) return bPri - aPri;
      return new Date(b.modified) - new Date(a.modified);
    });

    // === STEP 3: Slug grouping ===
    const slugMap = new Map(); // slug → sessions[]
    const ungrouped: SessionObj[] = [];
    for (const session of filtered) {
      if (session.slug) {
        if (!slugMap.has(session.slug)) slugMap.set(session.slug, []);
        slugMap.get(session.slug).push(session);
      } else {
        ungrouped.push(session);
      }
    }

    // Build render items (slug group = 1 item)
    const allItems: {
      sortTime: number;
      pinned: boolean;
      running: boolean;
      element: HTMLDivElement;
      effectiveSortTime?: number;
    }[] = [];
    for (const session of ungrouped) {
      const isRunning =
        activePtyIds.has(session.sessionId) ||
        pendingSessions.has(session.sessionId);
      allItems.push({
        sortTime: new Date(session.modified).getTime(),
        pinned: Boolean(session.starred),
        running: isRunning,
        element: buildSessionItem(session),
      });
    }
    for (const [slug, sessions] of slugMap) {
      const mostRecentTime = Math.max(
        ...sessions.map((s) => new Date(s.modified).getTime()),
      );
      const hasRunning = sessions.some(
        (s) =>
          activePtyIds.has(s.sessionId) || pendingSessions.has(s.sessionId),
      );
      const hasPinned = sessions.some((s) => s.starred);
      const element =
        sessions.length === 1
          ? buildSessionItem(sessions[0])
          : buildSlugGroup(slug, sessions);
      allItems.push({
        sortTime: mostRecentTime,
        pinned: hasPinned,
        running: hasRunning,
        element,
      });
    }

    // === STEP 4: Sort render items with debouncing ===
    // Compare each item's sortTime against snapshot. If the change is small
    // (background refresh touching mtime), keep the old sortTime to preserve order.
    // If the change is large (user opened an old session), use new sortTime.
    const fId = folderId(project.projectPath);
    for (const item of allItems) {
      const id = item.element.id;
      const prev = sortSnapshot.get(id);
      if (prev !== undefined) {
        const delta = Math.abs(item.sortTime - prev);
        if (delta < SORT_DRIFT_THRESHOLD) {
          item.effectiveSortTime = prev; // small drift — keep old position
        } else {
          item.effectiveSortTime = item.sortTime; // big jump — allow resort
        }
      } else {
        item.effectiveSortTime = item.sortTime; // new item
      }
    }
    allItems.sort((a, b) => {
      const aPri = a.pinned && a.running ? 3 : a.running ? 2 : a.pinned ? 1 : 0;
      const bPri = b.pinned && b.running ? 3 : b.running ? 2 : b.pinned ? 1 : 0;
      if (aPri !== bPri) return bPri - aPri;
      return b.effectiveSortTime - a.effectiveSortTime;
    });
    // Save snapshot: use effectiveSortTime so small drifts accumulate
    for (const item of allItems) {
      sortSnapshot.set(item.element.id, item.effectiveSortTime);
    }

    // === STEP 5: Truncate — split into visible vs older ===
    let visible: typeof allItems = [];
    let older: typeof allItems = [];
    if (isSearchResult || showStarredOnly || showRunningOnly || showTodayOnly) {
      visible = allItems;
    } else {
      let count = 0;
      const ageCutoff = Date.now() - sessionMaxAgeDays * 86400000;
      for (const item of allItems) {
        // Running and pinned always show; others must be within count AND age limit
        if (
          item.running ||
          item.pinned ||
          (count < visibleSessionCount && item.sortTime >= ageCutoff)
        ) {
          visible.push(item);
          count++;
        } else {
          older.push(item);
        }
      }
      // If visible is empty but older has items, show them directly
      if (visible.length === 0 && older.length > 0) {
        visible = older;
        older = [];
      }
    }

    // === STEP 6: Build DOM ===
    const group = document.createElement("div");
    group.className = "project-group";
    group.id = fId;

    const header = document.createElement("div");
    header.className = "project-header";
    header.id = `ph-${fId}`;
    const shortName = project.projectPath
      .split("/")
      .filter(Boolean)
      .slice(-2)
      .join("/");
    header.innerHTML = `<span class="arrow">&#9660;</span> <span class="project-name">${shortName}</span>`;

    const settingsBtn = document.createElement("button");
    settingsBtn.className = "project-settings-btn";
    settingsBtn.title = "Project settings";
    settingsBtn.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6.6 1h2.8l.4 2.1a5.5 5.5 0 0 1 1.3.8l2-.8 1.4 2.4-1.6 1.4a5.6 5.6 0 0 1 0 1.5l1.6 1.4-1.4 2.4-2-.8a5.5 5.5 0 0 1-1.3.8L9.4 15H6.6l-.4-2.1a5.5 5.5 0 0 1-1.3-.8l-2 .8-1.4-2.4 1.6-1.4a5.6 5.6 0 0 1 0-1.5L1.5 6.2l1.4-2.4 2 .8a5.5 5.5 0 0 1 1.3-.8L6.6 1z"/><circle cx="8" cy="8" r="2.5"/></svg>';
    header.appendChild(settingsBtn);

    const archiveGroupBtn = document.createElement("button");
    archiveGroupBtn.className = "project-archive-btn";
    archiveGroupBtn.title = "Archive all sessions";
    archiveGroupBtn.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1,1 L11,1 L11,4 L1,4 Z"/><path d="M1,4 L1,11 L11,11 L11,4"/><line x1="5" y1="6.5" x2="7" y2="6.5"/></svg>';
    header.appendChild(archiveGroupBtn);

    const newBtn = document.createElement("button");
    newBtn.className = "project-new-btn";
    newBtn.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="6" y1="2" x2="6" y2="10"/><line x1="2" y1="6" x2="10" y2="6"/></svg>';
    newBtn.title = "New session";
    header.appendChild(newBtn);

    const sessionsList = document.createElement("div");
    sessionsList.className = "project-sessions";
    sessionsList.id = `sessions-${fId}`;

    for (const item of visible) {
      sessionsList.appendChild(item.element);
    }

    if (older.length > 0) {
      const moreBtn = document.createElement("div");
      moreBtn.className = "sessions-more-toggle";
      moreBtn.id = `older-${fId}`;
      moreBtn.textContent = `+ ${older.length} older`;
      const olderList = document.createElement("div");
      olderList.className = "sessions-older";
      olderList.id = `older-list-${fId}`;
      olderList.style.display = "none";
      for (const item of older) {
        olderList.appendChild(item.element);
      }
      sessionsList.appendChild(moreBtn);
      sessionsList.appendChild(olderList);
    }

    // Auto-collapse if most recent session is older than 5 days
    if (!(isSearchResult || showStarredOnly || showRunningOnly)) {
      const mostRecent = filtered[0]?.modified;
      if (
        mostRecent &&
        Date.now() - new Date(mostRecent) > sessionMaxAgeDays * 86400000
      ) {
        header.classList.add("collapsed");
      }
    }

    group.appendChild(header);
    group.appendChild(sessionsList);
    newSidebar.appendChild(group);
  }

  // Re-apply active state
  if (activeSessionId) {
    const activeItem = newSidebar.querySelector(
      `[data-session-id="${activeSessionId}"]`,
    );
    if (activeItem) activeItem.classList.add("active");
  }

  morphdom(sidebarContent, newSidebar, {
    childrenOnly: true,
    onBeforeElUpdated(fromEl: HTMLElement, toEl: HTMLElement): boolean {
      if (fromEl.classList.contains("project-header")) {
        if (fromEl.classList.contains("collapsed")) {
          toEl.classList.add("collapsed");
        } else {
          toEl.classList.remove("collapsed");
        }
      }
      if (fromEl.classList.contains("slug-group")) {
        if (fromEl.classList.contains("collapsed")) {
          toEl.classList.add("collapsed");
        } else {
          toEl.classList.remove("collapsed");
        }
      }
      if (
        fromEl.classList.contains("sessions-older") &&
        fromEl.style.display !== "none"
      ) {
        toEl.style.display = "";
      }
      if (
        fromEl.classList.contains("sessions-more-toggle") &&
        fromEl.classList.contains("expanded")
      ) {
        toEl.classList.add("expanded");
        toEl.textContent = "- hide older";
      }
      if (
        fromEl.classList.contains("slug-group-older") &&
        fromEl.style.display !== "none"
      ) {
        toEl.style.display = "";
      }
      if (
        fromEl.classList.contains("slug-group-more") &&
        fromEl.classList.contains("expanded")
      ) {
        toEl.classList.add("expanded");
      }
      return true;
    },
    getNodeKey(node: HTMLElement): string | undefined {
      return node.id || undefined;
    },
  });

  rebindSidebarEvents(projects);
  lastRenderWasSearch = Boolean(isSearchResult);

  // Restore terminal focus after morphdom DOM updates, but not if the user is typing in the search box
  if (
    activeSessionId &&
    openSessions.has(activeSessionId) &&
    document.activeElement !== searchInput
  ) {
    openSessions.get(activeSessionId).terminal.focus();
  }
}

function rebindSidebarEvents(projects: ProjectObj[]): void {
  for (const project of projects) {
    const fId = folderId(project.projectPath);
    const header = document.getElementById(`ph-${fId}`);
    if (!header) continue;
    const newBtn = header.querySelector(".project-new-btn");
    if (newBtn) {
      (newBtn as HTMLElement).onclick = (e: MouseEvent): void => {
        e.stopPropagation();
        showNewSessionPopover(project, newBtn);
      };
    }
    const settingsBtn: Element | null = header.querySelector(
      ".project-settings-btn",
    );
    if (settingsBtn) {
      (settingsBtn as HTMLElement).onclick = (e: MouseEvent): void => {
        e.stopPropagation();
        void openSettingsViewer("project", project.projectPath);
      };
    }
    const archiveGroupBtn: Element | null = header.querySelector(
      ".project-archive-btn",
    );
    if (archiveGroupBtn) {
      (archiveGroupBtn as HTMLElement).onclick = async (
        e: MouseEvent,
      ): Promise<void> => {
        e.stopPropagation();
        const sessions = project.sessions.filter((s) => !s.archived);
        if (sessions.length === 0) return;
        const shortName = project.projectPath
          .split("/")
          .filter(Boolean)
          .slice(-2)
          .join("/");
        if (
          !confirm(
            `Archive all ${sessions.length} session${sessions.length > 1 ? "s" : ""} in ${shortName}?`,
          )
        )
          return;
        for (const s of sessions) {
          if (activePtyIds.has(s.sessionId)) {
            await window.api.stopSession(s.sessionId);
          }
          await window.api.archiveSession(s.sessionId, 1);
          s.archived = 1;
        }
        void pollActiveSessions();
        void loadProjects();
      };
    }
    header.onclick = (e: MouseEvent): void => {
      if (
        (e.target as HTMLElement).closest(".project-new-btn") ||
        (e.target as HTMLElement).closest(".project-archive-btn") ||
        (e.target as HTMLElement).closest(".project-settings-btn")
      )
        return;
      header.classList.toggle("collapsed");
    };
  }

  for (const slugHeader of sidebarContent.querySelectorAll(
    ".slug-group-header",
  )) {
    const archiveBtn: Element | null = slugHeader.querySelector(
      ".slug-group-archive-btn",
    );
    if (archiveBtn) {
      (archiveBtn as HTMLElement).onclick = async (
        e: MouseEvent,
      ): Promise<void> => {
        e.stopPropagation();
        const group: HTMLElement | null = slugHeader.parentElement;
        const sessionItems: NodeListOf<Element> = group
          ? group.querySelectorAll(".session-item")
          : document.querySelectorAll(".never-match-empty");
        for (const item of sessionItems) {
          const sid: string | undefined = (item as HTMLElement).dataset
            .sessionId;
          if (!sid) continue;
          const session: SessionObj | undefined = sessionMap.get(sid);
          if (!session || session.archived) continue;
          if (activePtyIds.has(sid)) await window.api.stopSession(sid);
          await window.api.archiveSession(sid, 1);
          session.archived = 1;
        }
        void pollActiveSessions();
        void loadProjects();
      };
    }
    (slugHeader as HTMLElement).onclick = (e: MouseEvent): void => {
      if ((e.target as HTMLElement).closest(".slug-group-archive-btn")) return;
      slugHeader.parentElement?.classList.toggle("collapsed");
      saveExpandedSlugs();
    };
  }

  for (const moreBtn of sidebarContent.querySelectorAll(".slug-group-more")) {
    (moreBtn as HTMLElement).onclick = (): void => {
      const group: Element | null = moreBtn.closest(".slug-group");
      if (group) {
        group.classList.remove("collapsed");
        saveExpandedSlugs();
      }
    };
  }

  for (const moreBtn of sidebarContent.querySelectorAll(
    ".sessions-more-toggle",
  )) {
    const olderList: Element | null = moreBtn.nextElementSibling;
    if (!olderList?.classList.contains("sessions-older")) continue;
    const count: number = olderList.children.length;
    (moreBtn as HTMLElement).onclick = (): void => {
      const showing: boolean =
        (olderList as HTMLElement).style.display !== "none";
      (olderList as HTMLElement).style.display = showing ? "none" : "";
      moreBtn.classList.toggle("expanded", !showing);
      moreBtn.textContent = showing ? `+ ${count} older` : "- hide older";
    };
  }

  for (const item of sidebarContent.querySelectorAll(".session-item")) {
    const sessionId: string | undefined = (item as HTMLElement).dataset
      .sessionId;
    const session: SessionObj | undefined = sessionId
      ? sessionMap.get(sessionId)
      : undefined;
    if (!session) continue;

    (item as HTMLElement).onclick = (): void => void openSession(session);

    const pin: Element | null = item.querySelector(".session-pin");
    if (pin) {
      (pin as HTMLElement).onclick = async (e: MouseEvent): Promise<void> => {
        e.stopPropagation();
        const { starred } = await window.api.toggleStar(session.sessionId);
        session.starred = starred;
        renderProjects(showArchived ? cachedAllProjects : cachedProjects);
      };
    }

    const summaryEl: Element | null = item.querySelector(".session-summary");
    if (summaryEl) {
      (summaryEl as HTMLElement).ondblclick = (e: MouseEvent): void => {
        e.stopPropagation();
        startRename(summaryEl, session);
      };
    }

    const stopBtn: Element | null = item.querySelector(".session-stop-btn");
    if (stopBtn) {
      (stopBtn as HTMLElement).onclick = async (
        e: MouseEvent,
      ): Promise<void> => {
        e.stopPropagation();
        await window.api.stopSession(session.sessionId);
        activePtyIds.delete(session.sessionId);
        if (activeSessionId === session.sessionId) {
          setActiveSession(null);
          terminalHeader.style.display = "none";
          placeholder.style.display = "";
        }
        renderProjects(showArchived ? cachedAllProjects : cachedProjects);
      };
    }

    const forkBtn: Element | null = item.querySelector(".session-fork-btn");
    if (forkBtn) {
      (forkBtn as HTMLElement).onclick = async (
        e: MouseEvent,
      ): Promise<void> => {
        e.stopPropagation();
        // Find the project for this session
        const project: ProjectObj | undefined = [
          ...cachedAllProjects,
          ...cachedProjects,
        ].find((p: ProjectObj) =>
          p.sessions.some((s: SessionObj) => s.sessionId === session.sessionId),
        );
        if (project) {
          void forkSession(session, project);
        }
      };
    }

    const jsonlBtn: Element | null = item.querySelector(".session-jsonl-btn");
    if (jsonlBtn) {
      (jsonlBtn as HTMLElement).onclick = (e: MouseEvent): void => {
        e.stopPropagation();
        void showJsonlViewer(session);
      };
    }

    const archiveBtn: Element | null = item.querySelector(
      ".session-archive-btn",
    );
    if (archiveBtn) {
      (archiveBtn as HTMLElement).onclick = async (
        e: MouseEvent,
      ): Promise<void> => {
        e.stopPropagation();
        const newVal = session.archived ? 0 : 1;
        if (newVal && activePtyIds.has(session.sessionId)) {
          await window.api.stopSession(session.sessionId);
          void pollActiveSessions();
        }
        await window.api.archiveSession(session.sessionId, newVal);
        session.archived = newVal;
        void loadProjects();
      };
    }
  }
}

function buildSessionItem(session: SessionObj): HTMLDivElement {
  const item = document.createElement("div");
  item.className = "session-item";
  item.id = `si-${session.sessionId}`;
  if (session.type === "terminal") item.classList.add("is-terminal");
  if (session.archived) item.classList.add("archived-item");
  if (activePtyIds.has(session.sessionId))
    item.classList.add("has-running-pty");
  if (unreadSessions.has(session.sessionId)) item.classList.add("has-unread");
  if (attentionSessions.has(session.sessionId))
    item.classList.add("needs-attention");
  item.dataset.sessionId = session.sessionId;

  const modified =
    lastActivityTime.get(session.sessionId) || new Date(session.modified);
  const timeStr = formatDate(modified);
  const displayName = cleanDisplayName(session.name || session.summary);

  const row = document.createElement("div");
  row.className = "session-row";

  // Pin
  const pin = document.createElement("span");
  pin.className = `session-pin${session.starred ? " pinned" : ""}`;
  pin.innerHTML = session.starred
    ? '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M9.828.722a.5.5 0 0 1 .354.146l4.95 4.95a.5.5 0 0 1-.707.707c-.28-.28-.576-.49-.888-.656L10.073 9.333l-.07 3.181a.5.5 0 0 1-.853.354l-3.535-3.536-4.243 4.243a.5.5 0 1 1-.707-.707l4.243-4.243L1.372 5.11a.5.5 0 0 1 .354-.854l3.18-.07L8.37 .722A3.37 3.37 0 0 1 9.12.074a.5.5 0 0 1 .708.002l-.707.707z"/></svg>'
    : '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M9.828.722a.5.5 0 0 1 .354.146l4.95 4.95a.5.5 0 0 1-.707.707c-.28-.28-.576-.49-.888-.656L10.073 9.333l-.07 3.181a.5.5 0 0 1-.853.354l-3.535-3.536-4.243 4.243a.5.5 0 1 1-.707-.707l4.243-4.243L1.372 5.11a.5.5 0 0 1 .354-.854l3.18-.07L8.37 .722A3.37 3.37 0 0 1 9.12.074a.5.5 0 0 1 .708.002l-.707.707z"/></svg>';

  // Running status dot
  const dot = document.createElement("span");
  dot.className =
    "session-status-dot" +
    (activePtyIds.has(session.sessionId) ? " running" : "");

  // Info block
  const info = document.createElement("div");
  info.className = "session-info";

  const summaryEl = document.createElement("div");
  summaryEl.className = "session-summary";
  summaryEl.textContent = displayName;

  const idEl = document.createElement("div");
  idEl.className = "session-id";
  idEl.textContent = session.sessionId;

  const metaEl = document.createElement("div");
  metaEl.className = "session-meta";
  metaEl.textContent =
    timeStr +
    (session.messageCount ? ` \u00b7 ${session.messageCount} msgs` : "");

  if (session.type === "terminal") {
    const badge = document.createElement("span");
    badge.className = "terminal-badge";
    badge.textContent = ">_";
    summaryEl.prepend(badge);
  }
  info.appendChild(summaryEl);
  info.appendChild(idEl);
  info.appendChild(metaEl);

  // Action buttons container
  const actions = document.createElement("div");
  actions.className = "session-actions";

  const stopBtn = document.createElement("button");
  stopBtn.className = "session-stop-btn";
  stopBtn.title = "Stop session";
  stopBtn.innerHTML =
    '<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="2" width="8" height="8" rx="1"/></svg>';

  const archiveBtn = document.createElement("button");
  archiveBtn.className = "session-archive-btn";
  archiveBtn.title = session.archived ? "Unarchive" : "Archive";
  archiveBtn.innerHTML = session.archived
    ? '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="4,7 6,5 8,7"/><line x1="6" y1="5" x2="6" y2="10"/><path d="M1,4 L1,11 L11,11 L11,4"/></svg>'
    : '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1,1 L11,1 L11,4 L1,4 Z"/><path d="M1,4 L1,11 L11,11 L11,4"/><line x1="5" y1="6.5" x2="7" y2="6.5"/></svg>';

  const forkBtn = document.createElement("button");
  forkBtn.className = "session-fork-btn";
  forkBtn.title = "Fork session";
  forkBtn.innerHTML =
    '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="6" cy="2.5" r="1.5"/><circle cx="3" cy="9.5" r="1.5"/><circle cx="9" cy="9.5" r="1.5"/><line x1="6" y1="4" x2="6" y2="6"/><line x1="6" y1="6" x2="3" y2="8"/><line x1="6" y1="6" x2="9" y2="8"/></svg>';

  const jsonlBtn = document.createElement("button");
  jsonlBtn.className = "session-jsonl-btn";
  jsonlBtn.title = "View messages";
  jsonlBtn.innerHTML =
    '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3h8M2 6h6M2 9h4"/></svg>';

  actions.appendChild(stopBtn);
  actions.appendChild(forkBtn);
  actions.appendChild(jsonlBtn);
  actions.appendChild(archiveBtn);

  row.appendChild(pin);
  row.appendChild(dot);
  row.appendChild(info);
  row.appendChild(actions);
  item.appendChild(row);

  return item;
}

function startRename(summaryEl: Element, session: SessionObj): void {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "session-rename-input";
  input.value = session.name || session.summary;

  summaryEl.replaceWith(input);
  input.focus();
  input.select();

  const save = async (): Promise<void> => {
    const newName = input.value.trim();
    const nameToSave = newName && newName !== session.summary ? newName : null;
    await window.api.renameSession(session.sessionId, nameToSave);
    session.name = nameToSave;

    const newSummary = document.createElement("div");
    newSummary.className = "session-summary";
    newSummary.textContent = nameToSave || session.summary;
    newSummary.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      startRename(newSummary, session);
    });
    input.replaceWith(newSummary);
  };

  input.addEventListener("blur", save);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") {
      input.removeEventListener("blur", save);
      const restored = document.createElement("div");
      restored.className = "session-summary";
      restored.textContent = session.name || session.summary;
      restored.addEventListener("dblclick", (ev) => {
        ev.stopPropagation();
        startRename(restored, session);
      });
      input.replaceWith(restored);
    }
  });
}

async function launchNewSession(
  project: ProjectObj,
  sessionOptions?: Record<string, unknown>,
): Promise<void> {
  const sessionId = crypto.randomUUID();
  const projectPath = project.projectPath;
  const session = {
    sessionId,
    summary: "New session",
    firstPrompt: "",
    projectPath,
    name: null,
    starred: 0,
    archived: 0,
    messageCount: 0,
    modified: new Date().toISOString(),
    created: new Date().toISOString(),
  };

  // Track as pending (no .jsonl yet)
  const folder = projectPath.replace(/[/_]/g, "-").replace(/^-/, "-");
  pendingSessions.set(sessionId, { session, projectPath, folder });

  // Inject into cached project data so it appears in sidebar immediately
  sessionMap.set(sessionId, session);
  for (const projList of [cachedProjects, cachedAllProjects]) {
    let proj = projList.find((p) => p.projectPath === projectPath);
    if (!proj) {
      proj = { folder, projectPath, sessions: [] };
      projList.unshift(proj);
    }
    proj.sessions.unshift(session);
  }
  renderProjects(showArchived ? cachedAllProjects : cachedProjects);

  // Update sidebar
  for (const el of document.querySelectorAll(".session-item.active")) {
    el.classList.remove("active");
  }
  const item: Element | null = document.querySelector(
    `[data-session-id="${sessionId}"]`,
  );
  if (item) item.classList.add("active");
  for (const el of document.querySelectorAll(".terminal-container")) {
    el.classList.remove("visible");
  }
  placeholder.style.display = "none";
  hidePlanViewer();
  setActiveSession(sessionId);
  showTerminalHeader(session);

  // Create terminal
  const container: HTMLDivElement = document.createElement("div");
  container.className = "terminal-container visible";
  terminalsEl.appendChild(container);

  const terminal: Terminal = new Terminal({
    fontSize: 12,
    fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
    theme: TERMINAL_THEME,
    cursorBlink: true,
    scrollback: 10000,
    convertEol: true,
  });

  const fitAddon: FitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(
    new WebLinksAddon((_event, url) => window.api.openExternal(url)),
  );
  terminal.open(container);
  fitAddon.fit();

  const entry = {
    terminal,
    element: container,
    fitAddon,
    session,
    closed: false,
  };
  openSessions.set(sessionId, entry);

  // Wire up terminal input/resize via IPC
  terminal.onData((data) => {
    window.api.sendInput(session.sessionId, data);
  });
  attachTerminalKeyHandler(terminal, () => session.sessionId);

  terminal.onResize(({ cols, rows }) => {
    window.api.resizeTerminal(session.sessionId, cols, rows);
  });

  terminal.onTitleChange((title) => {
    entry.ptyTitle = title;
    if (activeSessionId === session.sessionId) updatePtyTitle();
  });

  terminal.onBell(() => {
    markUnread(session.sessionId, "\x07");
  });

  // Open terminal in main process with session options
  const result = await window.api.openTerminal(
    sessionId,
    projectPath,
    true,
    sessionOptions || null,
  );
  if (!result.ok) {
    terminal.write(`\r\nError: ${result.error}\r\n`);
    entry.closed = true;
    return;
  }

  // Send initial resize
  window.api.resizeTerminal(sessionId, terminal.cols, terminal.rows);

  terminal.focus();
  void pollActiveSessions();
}

// Legacy alias
function _openNewSession(project: ProjectObj): Promise<void> {
  return launchNewSession(project);
}

function showTerminalHeader(session: SessionObj): void {
  const displayName = cleanDisplayName(session.name || session.summary);
  terminalHeaderName.textContent = displayName;
  terminalHeaderId.textContent = session.sessionId;
  terminalHeader.style.display = "";
  updateTerminalHeader();
  updateProgressIndicators(session.sessionId);
}

async function openSession(session: SessionObj): Promise<void> {
  const { sessionId, projectPath } = session;

  // Update sidebar active state
  for (const el of document.querySelectorAll(".session-item.active")) {
    el.classList.remove("active");
  }
  const item: Element | null = document.querySelector(
    `[data-session-id="${sessionId}"]`,
  );
  if (item) item.classList.add("active");

  // Hide all terminal containers and plan viewer
  for (const el of document.querySelectorAll(".terminal-container")) {
    el.classList.remove("visible");
  }
  placeholder.style.display = "none";
  hidePlanViewer();
  setActiveSession(sessionId);
  clearUnread(sessionId);
  attentionSessions.delete(sessionId);
  const attentionItem = document.querySelector(
    `.session-item[data-session-id="${sessionId}"]`,
  );
  if (attentionItem) attentionItem.classList.remove("needs-attention");
  showTerminalHeader(session);

  if (openSessions.has(sessionId)) {
    const entry = openSessions.get(sessionId);
    if (entry.closed) {
      window.api.closeTerminal(sessionId);
      entry.terminal.dispose();
      entry.element.remove();
      openSessions.delete(sessionId);
      // Terminal sessions re-spawn fresh
      if (session.type === "terminal") {
        void launchTerminalSession({ projectPath: session.projectPath });
        return;
      }
    } else {
      entry.element.classList.add("visible");
      entry.fitAddon.fit();
      entry.terminal.focus();
      // Defer scrollToBottom — fit() triggers an async re-render and
      // scrolling before it completes lands at a stale viewport height.
      requestAnimationFrame(() => entry.terminal.scrollToBottom());
      return;
    }
  }

  // Create new terminal
  const container = document.createElement("div");
  container.className = "terminal-container visible";
  terminalsEl.appendChild(container);

  const terminal = new Terminal({
    fontSize: 12,
    fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
    theme: TERMINAL_THEME,
    cursorBlink: true,
    scrollback: 10000,
    convertEol: true,
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(
    new WebLinksAddon((_event, url) => window.api.openExternal(url)),
  );
  terminal.open(container);
  fitAddon.fit();

  const entry = {
    terminal,
    element: container,
    fitAddon,
    session,
    closed: false,
  };
  openSessions.set(sessionId, entry);

  // Wire up terminal input/resize via IPC (use entry.session.sessionId so fork re-keying works)
  terminal.onData((data) => {
    window.api.sendInput(entry.session.sessionId, data);
  });
  attachTerminalKeyHandler(terminal, () => entry.session.sessionId);

  terminal.onResize(({ cols, rows }) => {
    window.api.resizeTerminal(entry.session.sessionId, cols, rows);
  });

  terminal.onTitleChange((title) => {
    entry.ptyTitle = title;
    if (activeSessionId === entry.session.sessionId) updatePtyTitle();
  });

  terminal.onBell(() => {
    markUnread(entry.session.sessionId, "\x07");
  });

  // Open terminal in main process with resolved default settings
  const resumeOptions = await resolveDefaultSessionOptions({ projectPath });
  const result = await window.api.openTerminal(
    sessionId,
    projectPath,
    false,
    resumeOptions,
  );
  if (!result.ok) {
    terminal.write(`\r\nError: ${result.error}\r\n`);
    entry.closed = true;
    return;
  }

  // Send initial resize
  window.api.resizeTerminal(sessionId, terminal.cols, terminal.rows);

  terminal.focus();
  void pollActiveSessions();
}

// Handle window resize
// Resize: fit immediately, scroll to bottom as PTY re-render data arrives
let resizeScrollActive: ReturnType<typeof setTimeout> | null = null;
window.addEventListener("resize", () => {
  if (activeSessionId && openSessions.has(activeSessionId)) {
    const entry = openSessions.get(activeSessionId);
    entry.fitAddon.fit();
    clearTimeout(resizeScrollActive);
    resizeScrollActive = setTimeout(() => {
      resizeScrollActive = null;
    }, 1000);
  }
});

function cleanDisplayName(name: string): string {
  if (!name) return name;
  const prefix: string = "Implement the following plan:";
  if (name.startsWith(prefix)) return name.slice(prefix.length).trim();
  return name;
}

function formatDate(date: Date): string {
  const formatNow: Date = new Date();
  const diff: number = formatNow.getTime() - date.getTime();
  const mins: number = Math.floor(diff / 60000);
  const hours: number = Math.floor(diff / 3600000);
  const days: number = Math.floor(diff / 86400000);

  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// --- Tab switching ---
for (const tab of document.querySelectorAll(".sidebar-tab")) {
  tab.addEventListener("click", () => {
    const tabName: string | undefined = (tab as HTMLElement).dataset.tab;
    if (tabName === activeTab) return;
    activeTab = tabName || "sessions";
    for (const t of document.querySelectorAll(".sidebar-tab")) {
      t.classList.toggle("active", (t as HTMLElement).dataset.tab === tabName);
    }

    // Clear search on tab switch
    searchInput.value = "";
    searchBar.classList.remove("has-query");

    // Hide all sidebar content areas
    sidebarContent.style.display = "none";
    plansContent.style.display = "none";
    statsContent.style.display = "none";
    memoryContent.style.display = "none";
    sessionFilters.style.display = "none";
    searchBar.style.display = "none";

    if (tabName === "sessions") {
      sessionFilters.style.display = "";
      searchBar.style.display = "";
      sidebarContent.style.display = "";
      // Restore terminal area if a session is open
      hideAllViewers();
      if (!activeSessionId) {
        placeholder.style.display = "";
      }
      // Catch up on changes that happened while on another tab
      if (projectsChangedWhileAway) {
        projectsChangedWhileAway = false;
        void loadProjects();
      }
    } else if (tabName === "plans") {
      searchBar.style.display = "";
      plansContent.style.display = "";
      void loadPlans();
    } else if (tabName === "stats") {
      statsContent.style.display = "";
      // Immediately show stats viewer in main area
      placeholder.style.display = "none";
      terminalArea.style.display = "none";
      planViewer.style.display = "none";
      memoryViewer.style.display = "none";
      settingsViewer.style.display = "none";
      statsViewer.style.display = "flex";
      void loadStats();
    } else if (tabName === "memory") {
      searchBar.style.display = "";
      memoryContent.style.display = "";
      void loadMemories();
    }
  });
}

// --- Plans ---
async function loadPlans(): Promise<void> {
  cachedPlans = await window.api.getPlans();
  renderPlans();
}

function renderPlans(plansArg?: ProjectObj[]): void {
  const plans: ProjectObj[] = plansArg || cachedPlans;
  plansContent.innerHTML = "";
  if (plans.length === 0) {
    const empty = document.createElement("div");
    empty.className = "plans-empty";
    empty.textContent = "No plans found in ~/.claude/plans/";
    plansContent.appendChild(empty);
    return;
  }
  for (const plan of plans) {
    plansContent.appendChild(buildPlanItem(plan));
  }
}

function buildPlanItem(plan: ProjectObj): HTMLDivElement {
  const item = document.createElement("div");
  item.className = "session-item plan-item";

  const row = document.createElement("div");
  row.className = "session-row";

  const info = document.createElement("div");
  info.className = "session-info";

  const titleEl = document.createElement("div");
  titleEl.className = "session-summary";
  titleEl.textContent = plan.title;

  const filenameEl = document.createElement("div");
  filenameEl.className = "session-id";
  filenameEl.textContent = plan.filename;

  const metaEl = document.createElement("div");
  metaEl.className = "session-meta";
  metaEl.textContent = formatDate(new Date(plan.modified));

  info.appendChild(titleEl);
  info.appendChild(filenameEl);
  info.appendChild(metaEl);
  row.appendChild(info);
  item.appendChild(row);

  item.addEventListener("click", () => openPlan(plan));
  return item;
}

async function openPlan(plan: ProjectObj): Promise<void> {
  // Mark active in sidebar
  for (const el of plansContent.querySelectorAll(".plan-item.active")) {
    el.classList.remove("active");
  }
  for (const el of plansContent.querySelectorAll(".plan-item")) {
    if (el.querySelector(".session-id")?.textContent === plan.filename) {
      el.classList.add("active");
    }
  }

  const result = await window.api.readPlan(plan.filename);
  currentPlanContent = result.content;
  currentPlanFilePath = result.filePath;
  _currentPlanFilename = plan.filename;

  // Hide terminal area and placeholder, show plan viewer
  placeholder.style.display = "none";
  terminalArea.style.display = "none";
  statsViewer.style.display = "none";
  memoryViewer.style.display = "none";
  settingsViewer.style.display = "none";
  planViewer.style.display = "flex";

  planViewerTitle.textContent = plan.title;
  planViewerFilepath.textContent = currentPlanFilePath;

  // Create or update CodeMirror editor
  if (!planEditorView) {
    planEditorView = createPlanEditor(planViewerEditorEl);
  }
  planEditorView.dispatch({
    changes: {
      from: 0,
      to: planEditorView.state.doc.length,
      insert: currentPlanContent,
    },
  });
}

// Plan toolbar button handlers
function flashButtonText(
  btn: HTMLElement,
  text: string,
  duration: number = 1200,
): void {
  const original = btn.textContent;
  btn.textContent = text;
  setTimeout(() => {
    btn.textContent = original;
  }, duration);
}

planCopyPathBtn.addEventListener("click", () => {
  navigator.clipboard.writeText(currentPlanFilePath);
  flashButtonText(planCopyPathBtn, "Copied!");
});

planCopyContentBtn.addEventListener("click", () => {
  const content = planEditorView
    ? planEditorView.state.doc.toString()
    : currentPlanContent;
  navigator.clipboard.writeText(content);
  flashButtonText(planCopyContentBtn, "Copied!");
});

planSaveBtn.addEventListener("click", async () => {
  if (planEditorView) {
    currentPlanContent = planEditorView.state.doc.toString();
  }
  await window.api.savePlan(currentPlanFilePath, currentPlanContent);
  flashButtonText(planSaveBtn, "Saved!");
});

function hideAllViewers(): void {
  planViewer.style.display = "none";
  statsViewer.style.display = "none";
  memoryViewer.style.display = "none";
  settingsViewer.style.display = "none";
  jsonlViewer.style.display = "none";
  terminalArea.style.display = "";
}

function hidePlanViewer(): void {
  hideAllViewers();
}

// --- JSONL Message History Viewer ---
function renderJsonlText(text: string): string {
  let html = escapeHtml(text);
  html = html.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    '<pre class="jsonl-code-block"><code>$2</code></pre>',
  );
  html = html.replace(
    /`([^`]+)`/g,
    '<code class="jsonl-inline-code">$1</code>',
  );
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  return html;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = (ms / 1000).toFixed(1);
  return `${s}s`;
}

function makeCollapsible(
  className: string,
  headerText: string,
  bodyContent: unknown,
  startExpanded: boolean,
): HTMLDivElement {
  const wrapper = document.createElement("div");
  wrapper.className = className;
  const header = document.createElement("div");
  header.className = `jsonl-toggle${startExpanded ? " expanded" : ""}`;
  header.textContent = headerText;
  const body = document.createElement("pre");
  body.className = "jsonl-tool-body";
  body.style.display = startExpanded ? "" : "none";
  if (typeof bodyContent === "string") {
    body.textContent = bodyContent;
  } else {
    try {
      body.textContent = JSON.stringify(bodyContent, null, 2);
    } catch {
      body.textContent = String(bodyContent);
    }
  }
  header.onclick = (): void => {
    const showing: boolean = body.style.display !== "none";
    body.style.display = showing ? "none" : "";
    header.classList.toggle("expanded", !showing);
  };
  wrapper.appendChild(header);
  wrapper.appendChild(body);
  return wrapper;
}

function renderJsonlEntry(
  entry: Record<string, unknown>,
): HTMLDivElement | null {
  const ts = entry.timestamp;
  const timeStr = ts ? new Date(ts).toLocaleTimeString() : "";

  // --- custom-title ---
  if (entry.type === "custom-title") {
    const div = document.createElement("div");
    div.className = "jsonl-entry jsonl-meta-entry";
    div.innerHTML =
      '<span class="jsonl-meta-icon">T</span> Title set: <strong>' +
      escapeHtml(entry.customTitle || "") +
      "</strong>";
    return div;
  }

  // --- system entries ---
  if (entry.type === "system") {
    const div = document.createElement("div");
    div.className = "jsonl-entry jsonl-meta-entry";
    if (entry.subtype === "turn_duration") {
      div.innerHTML =
        '<span class="jsonl-meta-icon">&#9201;</span> Turn duration: <strong>' +
        formatDuration(entry.durationMs) +
        "</strong>" +
        (timeStr ? ` <span class="jsonl-ts">${timeStr}</span>` : "");
    } else if (entry.subtype === "local_command") {
      const cmdMatch = (entry.content || "").match(
        /<command-name>(.*?)<\/command-name>/,
      );
      const cmd = cmdMatch ? cmdMatch[1] : entry.content || "unknown";
      div.innerHTML =
        '<span class="jsonl-meta-icon">$</span> Command: <code class="jsonl-inline-code">' +
        escapeHtml(cmd) +
        "</code>" +
        (timeStr ? ` <span class="jsonl-ts">${timeStr}</span>` : "");
    } else {
      return null;
    }
    return div;
  }

  // --- progress entries ---
  if (entry.type === "progress") {
    const data = entry.data;
    if (!data || typeof data !== "object") return null;
    const dt = data.type;
    if (dt === "bash_progress") {
      const div = document.createElement("div");
      div.className = "jsonl-entry jsonl-meta-entry";
      const elapsed = data.elapsedTimeSeconds
        ? ` (${data.elapsedTimeSeconds}s, ${data.totalLines || 0} lines)`
        : "";
      div.innerHTML =
        '<span class="jsonl-meta-icon">&#9658;</span> Bash output' +
        escapeHtml(elapsed);
      if (data.output || data.fullOutput) {
        const output = data.fullOutput || data.output || "";
        div.appendChild(
          makeCollapsible("jsonl-tool-result", "Output", output, false),
        );
      }
      return div;
    }
    // Skip noisy progress types
    return null;
  }

  // --- user / assistant messages ---
  let role: string | null = null;
  // biome-ignore lint/suspicious/noExplicitAny: JSONL content blocks have dynamic shapes
  let contentBlocks: any = null;

  if (
    entry.type === "user" ||
    (entry.type === "message" && entry.role === "user")
  ) {
    role = "user";
    contentBlocks = entry.message?.content || entry.content;
  } else if (
    entry.type === "assistant" ||
    (entry.type === "message" && entry.role === "assistant")
  ) {
    role = "assistant";
    contentBlocks = entry.message?.content || entry.content;
  } else {
    return null;
  }

  if (!contentBlocks) return null;
  if (typeof contentBlocks === "string") {
    contentBlocks = [{ type: "text", text: contentBlocks }];
  }
  if (!Array.isArray(contentBlocks)) return null;

  const div = document.createElement("div");
  div.className = `jsonl-entry ${role === "user" ? "jsonl-user" : "jsonl-assistant"}`;

  const labelRow = document.createElement("div");
  labelRow.className = "jsonl-role-label";
  labelRow.textContent = role === "user" ? "User" : "Assistant";
  if (timeStr) {
    const tsSpan = document.createElement("span");
    tsSpan.className = "jsonl-ts";
    tsSpan.textContent = timeStr;
    labelRow.appendChild(tsSpan);
  }
  div.appendChild(labelRow);

  for (const block of contentBlocks) {
    if (block.type === "thinking" && block.thinking) {
      div.appendChild(
        makeCollapsible("jsonl-thinking", "Thinking", block.thinking, false),
      );
    } else if (block.type === "text" && block.text) {
      const textEl = document.createElement("div");
      textEl.className = "jsonl-text";
      textEl.innerHTML = renderJsonlText(block.text);
      div.appendChild(textEl);
    } else if (block.type === "tool_use") {
      div.appendChild(
        makeCollapsible(
          "jsonl-tool-call",
          `Tool: ${block.name || "unknown"}`,
          typeof block.input === "string" ? block.input : block.input,
          false,
        ),
      );
    } else if (block.type === "tool_result") {
      const resultContent = block.content || block.output || "";
      div.appendChild(
        makeCollapsible(
          "jsonl-tool-result",
          "Tool Result" +
            (block.tool_use_id
              ? ` (${block.tool_use_id.slice(0, 12)}...)`
              : ""),
          resultContent,
          false,
        ),
      );
    }
  }

  return div;
}

async function showJsonlViewer(session: SessionObj): Promise<void> {
  const result = await window.api.readSessionJsonl(session.sessionId);
  hideAllViewers();
  placeholder.style.display = "none";
  terminalArea.style.display = "none";
  jsonlViewer.style.display = "flex";

  const displayName = session.name || session.summary || session.sessionId;
  jsonlViewerTitle.textContent = displayName;
  jsonlViewerSessionId.textContent = session.sessionId;
  jsonlViewerBody.innerHTML = "";

  if (result.error) {
    jsonlViewerBody.innerHTML =
      '<div class="plans-empty">Error loading messages: ' +
      escapeHtml(result.error) +
      "</div>";
    return;
  }

  const entries = result.entries || [];
  let rendered = 0;
  for (const entry of entries) {
    const el = renderJsonlEntry(entry);
    if (el) {
      jsonlViewerBody.appendChild(el);
      rendered++;
    }
  }

  if (rendered === 0) {
    jsonlViewerBody.innerHTML =
      '<div class="plans-empty">No messages found in this session.</div>';
  }
}

// --- Stats ---
async function loadStats(): Promise<void> {
  const stats = await window.api.getStats();
  statsViewerBody.innerHTML = "";
  if (!stats) {
    statsViewerBody.innerHTML =
      '<div class="plans-empty">No stats data found. Run some Claude sessions first.</div>';
    return;
  }
  // dailyActivity may be an array of {date, messageCount, ...} or an object
  const rawDaily = stats.dailyActivity || {};
  const dailyMap = {};
  if (Array.isArray(rawDaily)) {
    for (const entry of rawDaily) {
      dailyMap[entry.date] = entry.messageCount || 0;
    }
  } else {
    for (const [date, data] of Object.entries(rawDaily)) {
      dailyMap[date] =
        typeof data === "number"
          ? data
          : data?.messageCount || data?.messages || data?.count || 0;
    }
  }
  buildHeatmap(dailyMap);
  buildDailyBarChart(stats);
  buildStatsSummary(stats, dailyMap);

  const notice = document.createElement("div");
  notice.className = "stats-notice";
  const lastDate = stats.lastComputedDate || "unknown";
  notice.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-2px;margin-right:6px;flex-shrink:0"><circle cx="8" cy="8" r="7"/><line x1="8" y1="5" x2="8" y2="9"/><circle cx="8" cy="11.5" r="0.5" fill="currentColor" stroke="none"/></svg>Data sourced from Claude\u2019s stats cache (last updated ${escapeHtml(lastDate)}). Run <code>/stats</code> in a Claude session to refresh.`;
  statsViewerBody.appendChild(notice);
}

function buildDailyBarChart(stats: Record<string, unknown>): void {
  const rawTokens = stats.dailyModelTokens || [];
  const rawActivity = stats.dailyActivity || [];

  // Build maps for last 30 days
  const tokenMap = {};
  if (Array.isArray(rawTokens)) {
    for (const entry of rawTokens) {
      let total = 0;
      for (const count of Object.values(entry.tokensByModel || {}))
        total += count;
      tokenMap[entry.date] = total;
    }
  }
  const activityMap = {};
  if (Array.isArray(rawActivity)) {
    for (const entry of rawActivity) activityMap[entry.date] = entry;
  }

  // Generate last 30 days
  const days: string[] = [];
  const today: Date = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }

  const tokenValues = days.map((d) => tokenMap[d] || 0);
  const msgValues = days.map((d) => activityMap[d]?.messageCount || 0);
  const toolValues = days.map((d) => activityMap[d]?.toolCallCount || 0);
  const maxTokens = Math.max(...tokenValues, 1);
  const maxMsgs = Math.max(...msgValues, 1);

  const container = document.createElement("div");
  container.className = "daily-chart-container";

  const title = document.createElement("div");
  title.className = "daily-chart-title";
  title.textContent = "Last 30 days";
  container.appendChild(title);

  const chart = document.createElement("div");
  chart.className = "daily-chart";

  for (let i = 0; i < days.length; i++) {
    const col = document.createElement("div");
    col.className = "daily-chart-col";

    const bar = document.createElement("div");
    bar.className = "daily-chart-bar";
    const pct = (tokenValues[i] / maxTokens) * 100;
    bar.style.height = `${Math.max(pct, tokenValues[i] > 0 ? 3 : 0)}%`;

    const msgPct = (msgValues[i] / maxMsgs) * 100;
    const msgBar = document.createElement("div");
    msgBar.className = "daily-chart-bar-msgs";
    msgBar.style.height = `${Math.max(msgPct, msgValues[i] > 0 ? 3 : 0)}%`;

    const d = new Date(days[i]);
    const dayLabel = d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    let tokStr: string;
    if (tokenValues[i] >= 1e6) tokStr = `${(tokenValues[i] / 1e6).toFixed(1)}M`;
    else if (tokenValues[i] >= 1e3)
      tokStr = `${(tokenValues[i] / 1e3).toFixed(1)}K`;
    else tokStr = tokenValues[i].toString();
    col.title = `${dayLabel}\n${tokStr} tokens\n${msgValues[i]} messages\n${toolValues[i]} tool calls`;

    const label = document.createElement("div");
    label.className = "daily-chart-label";
    label.textContent = d.getDate().toString();

    col.appendChild(bar);
    col.appendChild(msgBar);
    col.appendChild(label);
    chart.appendChild(col);
  }

  container.appendChild(chart);

  // Legend
  const legend = document.createElement("div");
  legend.className = "daily-chart-legend";
  legend.innerHTML =
    '<span class="daily-chart-legend-dot tokens"></span> Tokens <span class="daily-chart-legend-dot msgs"></span> Messages';
  container.appendChild(legend);

  statsViewerBody.appendChild(container);
}

function buildHeatmap(counts: Record<string, number>): void {
  const container = document.createElement("div");
  container.className = "heatmap-container";

  // Generate 52 weeks of dates ending today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayOfWeek = today.getDay(); // 0=Sun
  const endDate = new Date(today);
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - (52 * 7 + dayOfWeek));

  // Month labels
  const monthLabels = document.createElement("div");
  monthLabels.className = "heatmap-month-labels";
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  let lastMonth: number = -1;
  const weekStarts: Date[] = [];
  const d = new Date(startDate);
  while (d <= endDate) {
    if (d.getDay() === 0) {
      weekStarts.push(new Date(d));
    }
    d.setDate(d.getDate() + 1);
  }

  // Calculate month label positions
  const colWidth = 16; // 13px cell + 3px gap
  for (let w = 0; w < weekStarts.length; w++) {
    const m = weekStarts[w].getMonth();
    if (m !== lastMonth) {
      const label = document.createElement("span");
      label.className = "heatmap-month-label";
      label.textContent = months[m];
      label.style.position = "absolute";
      label.style.left = `${w * colWidth}px`;
      monthLabels.appendChild(label);
      lastMonth = m;
    }
  }
  monthLabels.style.position = "relative";
  monthLabels.style.height = "16px";
  container.appendChild(monthLabels);

  // Grid wrapper (day labels + grid)
  const wrapper = document.createElement("div");
  wrapper.className = "heatmap-grid-wrapper";

  // Day labels
  const dayLabels = document.createElement("div");
  dayLabels.className = "heatmap-day-labels";
  const dayNames = ["", "Mon", "", "Wed", "", "Fri", ""];
  for (const name of dayNames) {
    const label = document.createElement("div");
    label.className = "heatmap-day-label";
    label.textContent = name;
    dayLabels.appendChild(label);
  }
  wrapper.appendChild(dayLabels);

  // Quartile thresholds
  const nonZero = Object.values(counts)
    .filter((c) => c > 0)
    .sort((a, b) => a - b);
  const q1 = nonZero[Math.floor(nonZero.length * 0.25)] || 1;
  const q2 = nonZero[Math.floor(nonZero.length * 0.5)] || 2;
  const q3 = nonZero[Math.floor(nonZero.length * 0.75)] || 3;

  // Grid
  const grid = document.createElement("div");
  grid.className = "heatmap-grid";

  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    const dateStr = cursor.toISOString().slice(0, 10);
    const count = counts[dateStr] || 0;
    let level = 0;
    if (count > 0) {
      if (count <= q1) level = 1;
      else if (count <= q2) level = 2;
      else if (count <= q3) level = 3;
      else level = 4;
    }

    const cell = document.createElement("div");
    cell.className = `heatmap-cell heatmap-level-${level}`;
    const displayDate = cursor.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    cell.title =
      count > 0
        ? `${displayDate}: ${count} messages`
        : `${displayDate}: No activity`;
    grid.appendChild(cell);

    cursor.setDate(cursor.getDate() + 1);
  }

  wrapper.appendChild(grid);
  container.appendChild(wrapper);

  // Legend
  const legend = document.createElement("div");
  legend.className = "heatmap-legend";
  const lessLabel = document.createElement("span");
  lessLabel.className = "heatmap-legend-label";
  lessLabel.textContent = "Less";
  legend.appendChild(lessLabel);
  for (let i = 0; i <= 4; i++) {
    const cell = document.createElement("div");
    cell.className = `heatmap-legend-cell heatmap-level-${i}`;
    legend.appendChild(cell);
  }
  const moreLabel = document.createElement("span");
  moreLabel.className = "heatmap-legend-label";
  moreLabel.textContent = "More";
  legend.appendChild(moreLabel);
  container.appendChild(legend);

  statsViewerBody.appendChild(container);
}

function calculateStreak(counts: Record<string, number>): {
  current: number;
  longest: number;
} {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let current = 0;
  let longest = 0;
  let streak = 0;

  const d = new Date(today);
  let started = false;
  for (let i = 0; i < 365; i++) {
    const dateStr = d.toISOString().slice(0, 10);
    const count = counts[dateStr] || 0;
    if (count > 0) {
      streak++;
      started = true;
    } else {
      if (started) {
        if (!current) current = streak;
        if (streak > longest) longest = streak;
        streak = 0;
        started = false;
      }
    }
    d.setDate(d.getDate() - 1);
  }
  if (streak > longest) longest = streak;
  if (!current && streak > 0) current = streak;

  return { current, longest };
}

function buildStatsSummary(
  stats: Record<string, unknown>,
  dailyMap: Record<string, number>,
): void {
  const summaryEl = document.createElement("div");
  summaryEl.className = "stats-summary";

  const { current: currentStreak, longest: longestStreak } =
    calculateStreak(dailyMap);

  // Total messages from map
  let totalMessages = 0;
  for (const count of Object.values(dailyMap)) {
    totalMessages += count;
  }
  // Prefer stats.totalMessages if available and larger
  if (stats.totalMessages && stats.totalMessages > totalMessages) {
    totalMessages = stats.totalMessages;
  }

  const totalSessions = stats.totalSessions || Object.keys(dailyMap).length;

  // Model usage — values are objects with token counts, show as cards
  const models = stats.modelUsage || {};

  const cards = [
    { value: totalSessions.toLocaleString(), label: "Total Sessions" },
    { value: totalMessages.toLocaleString(), label: "Total Messages" },
    { value: `${currentStreak}d`, label: "Current Streak" },
    { value: `${longestStreak}d`, label: "Longest Streak" },
  ];

  for (const [model, usage] of Object.entries(models)) {
    const shortName = model.replace(/^claude-/, "").replace(/-\d{8}$/, "");
    const tokens = (usage?.inputTokens || 0) + (usage?.outputTokens || 0);
    const label = shortName;
    // Format token count in millions/thousands
    let valueStr: string;
    if (tokens >= 1e9) valueStr = `${(tokens / 1e9).toFixed(1)}B`;
    else if (tokens >= 1e6) valueStr = `${(tokens / 1e6).toFixed(1)}M`;
    else if (tokens >= 1e3) valueStr = `${(tokens / 1e3).toFixed(1)}K`;
    else valueStr = tokens.toLocaleString();
    cards.push({ value: valueStr, label: `${label} tokens` });
  }

  for (const card of cards) {
    const el = document.createElement("div");
    el.className = "stat-card";
    el.innerHTML = `<span class="stat-card-value">${escapeHtml(card.value)}</span><span class="stat-card-label">${escapeHtml(card.label)}</span>`;
    summaryEl.appendChild(el);
  }

  statsViewerBody.appendChild(summaryEl);
}

// --- Memory ---
let cachedMemories: ProjectObj[] = [];

async function loadMemories(): Promise<void> {
  cachedMemories = await window.api.getMemories();
  renderMemories();
}

function renderMemories(memoriesArg?: ProjectObj[]): void {
  const memories: ProjectObj[] = memoriesArg || cachedMemories;
  memoryContent.innerHTML = "";
  if (memories.length === 0) {
    const empty = document.createElement("div");
    empty.className = "plans-empty";
    empty.textContent = "No memory files found.";
    memoryContent.appendChild(empty);
    return;
  }
  for (const mem of memories) {
    memoryContent.appendChild(buildMemoryItem(mem));
  }
}

function buildMemoryItem(mem: ProjectObj): HTMLDivElement {
  const item = document.createElement("div");
  item.className = "session-item memory-item";

  const row = document.createElement("div");
  row.className = "session-row";

  const info = document.createElement("div");
  info.className = "session-info";

  const titleEl = document.createElement("div");
  titleEl.className = "session-summary";

  const badge = document.createElement("span");
  badge.className = `memory-type-badge type-${mem.type}`;
  badge.textContent = mem.type;
  titleEl.appendChild(badge);
  titleEl.appendChild(document.createTextNode(mem.label));

  const filenameEl = document.createElement("div");
  filenameEl.className = "session-id";
  filenameEl.textContent = mem.filename;

  const metaEl = document.createElement("div");
  metaEl.className = "session-meta";
  metaEl.textContent = formatDate(new Date(mem.modified));

  info.appendChild(titleEl);
  info.appendChild(filenameEl);
  info.appendChild(metaEl);
  row.appendChild(info);
  item.appendChild(row);

  item.addEventListener("click", () => openMemory(mem));
  return item;
}

async function openMemory(mem: ProjectObj): Promise<void> {
  // Mark active in sidebar
  for (const el of memoryContent.querySelectorAll(".memory-item.active")) {
    el.classList.remove("active");
  }
  for (const el of memoryContent.querySelectorAll(".memory-item")) {
    if (
      el.querySelector(".session-id")?.textContent === mem.filename &&
      el.querySelector(".session-summary")?.textContent?.includes(mem.label)
    ) {
      el.classList.add("active");
    }
  }

  const content = await window.api.readMemory(mem.filePath);

  // Show memory viewer in main area
  placeholder.style.display = "none";
  terminalArea.style.display = "none";
  planViewer.style.display = "none";
  statsViewer.style.display = "none";
  settingsViewer.style.display = "none";
  memoryViewer.style.display = "flex";

  memoryViewerTitle.textContent = `${mem.label} — ${mem.filename}`;
  memoryViewerFilename.textContent = mem.filePath;
  memoryViewerBody.textContent = content;
}

// --- New session dialog ---
async function resolveDefaultSessionOptions(
  project: ProjectObj,
): Promise<Record<string, unknown>> {
  const effective = await window.api.getEffectiveSettings(project.projectPath);
  const options = {};
  if (effective.dangerouslySkipPermissions) {
    options.dangerouslySkipPermissions = true;
  } else if (effective.permissionMode) {
    options.permissionMode = effective.permissionMode;
  }
  if (effective.worktree) {
    options.worktree = true;
    if (effective.worktreeName) options.worktreeName = effective.worktreeName;
  }
  if (effective.chrome) options.chrome = true;
  if (effective.preLaunchCmd) options.preLaunchCmd = effective.preLaunchCmd;
  if (effective.addDirs) options.addDirs = effective.addDirs;
  return options;
}

async function forkSession(
  session: SessionObj,
  project: ProjectObj,
): Promise<void> {
  const options: Record<string, unknown> =
    await resolveDefaultSessionOptions(project);
  options.forkFrom = session.sessionId;
  void launchNewSession(project, options);
}

function showNewSessionPopover(project: ProjectObj, anchorEl: Element): void {
  // Remove any existing popover
  for (const el of document.querySelectorAll(".new-session-popover")) {
    el.remove();
  }

  const popover = document.createElement("div");
  popover.className = "new-session-popover";

  const claudeBtn = document.createElement("button");
  claudeBtn.className = "popover-option";
  claudeBtn.innerHTML =
    '<img src="https://claude.ai/favicon.ico" class="popover-option-icon claude-icon" alt=""> Claude';
  claudeBtn.onclick = async (): Promise<void> => {
    popover.remove();
    void launchNewSession(project, await resolveDefaultSessionOptions(project));
  };

  const claudeOptsBtn = document.createElement("button");
  claudeOptsBtn.className = "popover-option";
  claudeOptsBtn.innerHTML =
    '<img src="https://claude.ai/favicon.ico" class="popover-option-icon claude-icon" alt=""> Claude (Configure...)';
  claudeOptsBtn.onclick = (): void => {
    popover.remove();
    void showNewSessionDialog(project);
  };

  const termBtn = document.createElement("button");
  termBtn.className = "popover-option popover-option-terminal";
  termBtn.innerHTML =
    '<span class="popover-option-icon terminal-icon">&gt;_</span> Terminal';
  termBtn.onclick = (): void => {
    popover.remove();
    void launchTerminalSession(project);
  };

  popover.appendChild(claudeBtn);
  popover.appendChild(claudeOptsBtn);
  popover.appendChild(termBtn);

  // Position relative to anchor, flip upward if it would overflow
  document.body.appendChild(popover);
  const rect = anchorEl.getBoundingClientRect();
  const popoverHeight = popover.offsetHeight;
  if (rect.bottom + 4 + popoverHeight > window.innerHeight) {
    popover.style.top = `${rect.top - popoverHeight - 4}px`;
  } else {
    popover.style.top = `${rect.bottom + 4}px`;
  }
  popover.style.left = `${rect.left}px`;

  // Close on click outside
  function onClickOutside(e: MouseEvent): void {
    if (!popover.contains(e.target as Node) && e.target !== anchorEl) {
      popover.remove();
      document.removeEventListener("mousedown", onClickOutside);
    }
  }
  setTimeout(() => document.addEventListener("mousedown", onClickOutside), 0);
}

async function launchTerminalSession(project: ProjectObj): Promise<void> {
  const sessionId = crypto.randomUUID();
  const projectPath = project.projectPath;
  const session = {
    sessionId,
    summary: "Terminal",
    firstPrompt: "",
    projectPath,
    name: null,
    starred: 0,
    archived: 0,
    messageCount: 0,
    modified: new Date().toISOString(),
    created: new Date().toISOString(),
    type: "terminal",
  };

  // Track as pending
  const folder = projectPath.replace(/[/_]/g, "-").replace(/^-/, "-");
  pendingSessions.set(sessionId, { session, projectPath, folder });

  // Inject into cached project data
  sessionMap.set(sessionId, session);
  for (const projList of [cachedProjects, cachedAllProjects]) {
    let proj = projList.find((p) => p.projectPath === projectPath);
    if (!proj) {
      proj = { folder, projectPath, sessions: [] };
      projList.unshift(proj);
    }
    proj.sessions.unshift(session);
  }
  renderProjects(showArchived ? cachedAllProjects : cachedProjects);

  // Update sidebar
  for (const el of document.querySelectorAll(".session-item.active")) {
    el.classList.remove("active");
  }
  const item: Element | null = document.querySelector(
    `[data-session-id="${sessionId}"]`,
  );
  if (item) item.classList.add("active");
  for (const el of document.querySelectorAll(".terminal-container")) {
    el.classList.remove("visible");
  }
  placeholder.style.display = "none";
  hidePlanViewer();
  setActiveSession(sessionId);
  showTerminalHeader(session);

  // Create terminal
  const container: HTMLDivElement = document.createElement("div");
  container.className = "terminal-container visible";
  terminalsEl.appendChild(container);

  const terminal: Terminal = new Terminal({
    fontSize: 12,
    fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
    theme: TERMINAL_THEME,
    cursorBlink: true,
    scrollback: 10000,
    convertEol: true,
  });

  const fitAddon: FitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(
    new WebLinksAddon((_event, url) => window.api.openExternal(url)),
  );
  terminal.open(container);
  fitAddon.fit();

  const entry = {
    terminal,
    element: container,
    fitAddon,
    session,
    closed: false,
  };
  openSessions.set(sessionId, entry);

  terminal.onData((data) => {
    window.api.sendInput(session.sessionId, data);
  });
  attachTerminalKeyHandler(terminal, () => session.sessionId);

  terminal.onResize(({ cols, rows }) => {
    window.api.resizeTerminal(session.sessionId, cols, rows);
  });

  terminal.onTitleChange((title) => {
    entry.ptyTitle = title;
    if (activeSessionId === session.sessionId) updatePtyTitle();
  });

  terminal.onBell(() => {
    markUnread(session.sessionId, "\x07");
  });

  const result = await window.api.openTerminal(sessionId, projectPath, true, {
    type: "terminal",
  });
  if (!result.ok) {
    terminal.write(`\r\nError: ${result.error}\r\n`);
    entry.closed = true;
    return;
  }

  window.api.resizeTerminal(sessionId, terminal.cols, terminal.rows);
  terminal.focus();
  void pollActiveSessions();
}

async function showNewSessionDialog(project: ProjectObj): Promise<void> {
  const effective = await window.api.getEffectiveSettings(project.projectPath);

  const overlay = document.createElement("div");
  overlay.className = "new-session-overlay";

  const dialog = document.createElement("div");
  dialog.className = "new-session-dialog";

  let selectedMode = effective.permissionMode || null;
  let dangerousSkip = effective.dangerouslySkipPermissions;

  const modes = [
    { value: null, label: "Default", desc: "Prompt for all actions" },
    {
      value: "acceptEdits",
      label: "Accept Edits",
      desc: "Auto-accept file edits, prompt for others",
    },
    {
      value: "plan",
      label: "Plan Mode",
      desc: "Read-only exploration, no writes",
    },
    {
      value: "dontAsk",
      label: "Don't Ask",
      desc: "Auto-deny tools not explicitly allowed",
    },
    {
      value: "bypassPermissions",
      label: "Bypass",
      desc: "Auto-accept all tool calls",
    },
  ];

  function renderModeGrid(): string {
    return (
      modes
        .map((m) => {
          const isSelected = !dangerousSkip && selectedMode === m.value;
          return `<button class="permission-option${isSelected ? " selected" : ""}" data-mode="${m.value}"><span class="perm-name">${m.label}</span><span class="perm-desc">${m.desc}</span></button>`;
        })
        .join("") +
      `<button class="permission-option dangerous${dangerousSkip ? " selected" : ""}" data-mode="dangerous-skip"><span class="perm-name">Dangerous Skip</span><span class="perm-desc">Skip all safety prompts (use with caution)</span></button>`
    );
  }

  dialog.innerHTML = `
    <h3>New Session — ${escapeHtml(project.projectPath.split("/").filter(Boolean).slice(-2).join("/"))}</h3>
    <div class="settings-field">
      <div class="settings-label">Permission Mode</div>
      <div class="permission-grid" id="nsd-mode-grid">${renderModeGrid()}</div>
    </div>
    <div class="settings-field">
      <div class="settings-checkbox-row">
        <input type="checkbox" id="nsd-worktree" ${effective.worktree ? "checked" : ""}>
        <label for="nsd-worktree">Worktree</label>
        <input type="text" class="settings-input" id="nsd-worktree-name" placeholder="name (optional)" value="${escapeHtml(effective.worktreeName || "")}" style="width:160px;margin-left:8px;">
      </div>
    </div>
    <div class="settings-field">
      <div class="settings-checkbox-row">
        <input type="checkbox" id="nsd-chrome" ${effective.chrome ? "checked" : ""}>
        <label for="nsd-chrome">Chrome</label>
      </div>
    </div>
    <div class="settings-field">
      <div class="settings-label">Pre-launch Command</div>
      <input type="text" class="settings-input" id="nsd-pre-launch" placeholder="e.g. aws-vault exec profile --" value="${escapeHtml(effective.preLaunchCmd || "")}">
    </div>
    <div class="settings-field">
      <div class="settings-label">Add Directories (comma-separated)</div>
      <input type="text" class="settings-input" id="nsd-add-dirs" placeholder="/path/to/dir1, /path/to/dir2" value="${escapeHtml(effective.addDirs || "")}">
    </div>
    <div class="new-session-actions">
      <button class="new-session-cancel-btn">Cancel</button>
      <button class="new-session-start-btn">Start</button>
    </div>
  `;

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  // Bind mode grid clicks
  const modeGrid = dialog.querySelector("#nsd-mode-grid");
  modeGrid.addEventListener("click", (e) => {
    const btn = e.target.closest(".permission-option");
    if (!btn) return;
    const mode = btn.dataset.mode;
    if (mode === "dangerous-skip") {
      dangerousSkip = !dangerousSkip;
      if (dangerousSkip) selectedMode = null;
    } else {
      dangerousSkip = false;
      selectedMode = mode === "null" ? null : mode;
    }
    modeGrid.innerHTML = renderModeGrid();
  });

  function close(): void {
    overlay.remove();
  }

  function start(): void {
    const options: Record<string, unknown> = {};
    if (dangerousSkip) {
      options.dangerouslySkipPermissions = true;
    } else if (selectedMode) {
      options.permissionMode = selectedMode;
    }
    if ((dialog.querySelector("#nsd-worktree") as HTMLInputElement).checked) {
      options.worktree = true;
      options.worktreeName = (
        dialog.querySelector("#nsd-worktree-name") as HTMLInputElement
      ).value.trim();
    }
    if ((dialog.querySelector("#nsd-chrome") as HTMLInputElement).checked) {
      options.chrome = true;
    }
    const preLaunch: string = (
      dialog.querySelector("#nsd-pre-launch") as HTMLInputElement
    ).value.trim();
    if (preLaunch) options.preLaunchCmd = preLaunch;
    options.addDirs = (
      dialog.querySelector("#nsd-add-dirs") as HTMLInputElement
    ).value.trim();
    close();
    void launchNewSession(project, options);
  }

  dialog.querySelector(".new-session-cancel-btn").onclick = close;
  dialog.querySelector(".new-session-start-btn").onclick = start;
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  // Keyboard support
  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      close();
      document.removeEventListener("keydown", onKey);
    }
    if (e.key === "Enter" && !(e.target as HTMLElement).matches("input")) {
      start();
      document.removeEventListener("keydown", onKey);
    }
  }
  document.addEventListener("keydown", onKey);
}

// --- Settings viewer ---
async function openSettingsViewer(
  scope: string,
  projectPath?: string,
): Promise<void> {
  const isProject = scope === "project";
  const settingsKey = isProject ? `project:${projectPath}` : "global";
  const current = (await window.api.getSetting(settingsKey)) || {};
  const globalSettings = isProject
    ? (await window.api.getSetting("global")) || {}
    : {};

  const shortName = isProject
    ? projectPath.split("/").filter(Boolean).slice(-2).join("/")
    : "Global";

  settingsViewerTitle.textContent =
    (isProject ? "Project Settings — " : "Global Settings — ") + shortName;

  // Show settings viewer
  placeholder.style.display = "none";
  terminalArea.style.display = "none";
  planViewer.style.display = "none";
  statsViewer.style.display = "none";
  memoryViewer.style.display = "none";
  settingsViewer.style.display = "flex";

  function useGlobalCheckbox(fieldName: string, _label?: string): string {
    if (!isProject) return "";
    const useGlobal =
      current[fieldName] === undefined || current[fieldName] === null;
    return `<label class="settings-use-global"><input type="checkbox" data-field="${fieldName}" class="use-global-cb" ${useGlobal ? "checked" : ""}> Use global default</label>`;
  }

  function fieldValue(fieldName: string, fallback: unknown): unknown {
    if (
      isProject &&
      (current[fieldName] === undefined || current[fieldName] === null)
    ) {
      return globalSettings[fieldName] !== undefined
        ? globalSettings[fieldName]
        : fallback;
    }
    return current[fieldName] !== undefined ? current[fieldName] : fallback;
  }

  function fieldDisabled(fieldName: string): string {
    if (!isProject) return "";
    return current[fieldName] === undefined || current[fieldName] === null
      ? "disabled"
      : "";
  }

  const permModeValue = fieldValue("permissionMode", "");
  const worktreeValue = fieldValue("worktree", false);
  const worktreeNameValue = fieldValue("worktreeName", "");
  const chromeValue = fieldValue("chrome", false);
  const preLaunchValue = fieldValue("preLaunchCmd", "");
  const addDirsValue = fieldValue("addDirs", "");
  const visCountValue = fieldValue("visibleSessionCount", 10);
  const maxAgeValue = fieldValue("sessionMaxAgeDays", 3);
  const themeValue = fieldValue("terminalTheme", "switchboard");

  settingsViewerBody.innerHTML = `
    <div class="settings-form">
      <div class="settings-section">
        <div class="settings-section-title">Claude CLI Options</div>
        <div class="settings-hint">These options are passed to the <code>claude</code> command when launching sessions.</div>

        <div class="settings-field">
          <div class="settings-field-header">
            <span class="settings-label">Permission Mode</span>
            ${useGlobalCheckbox("permissionMode")}
          </div>
          <select class="settings-select" id="sv-perm-mode" ${fieldDisabled("permissionMode")}>
            <option value="">Default (none)</option>
            <option value="acceptEdits" ${permModeValue === "acceptEdits" ? "selected" : ""}>Accept Edits</option>
            <option value="plan" ${permModeValue === "plan" ? "selected" : ""}>Plan Mode</option>
            <option value="dontAsk" ${permModeValue === "dontAsk" ? "selected" : ""}>Don't Ask</option>
            <option value="bypassPermissions" ${permModeValue === "bypassPermissions" ? "selected" : ""}>Bypass</option>
          </select>
        </div>

        <div class="settings-field">
          <div class="settings-field-header">
            <span class="settings-label">Worktree</span>
            ${useGlobalCheckbox("worktree")}
          </div>
          <div class="settings-checkbox-row">
            <input type="checkbox" id="sv-worktree" ${worktreeValue ? "checked" : ""} ${fieldDisabled("worktree")}>
            <label for="sv-worktree">Enable worktree for new sessions</label>
          </div>
        </div>

        <div class="settings-field">
          <div class="settings-field-header">
            <span class="settings-label">Worktree Name</span>
            ${useGlobalCheckbox("worktreeName")}
          </div>
          <input type="text" class="settings-input" id="sv-worktree-name" placeholder="auto" value="${escapeHtml(worktreeNameValue)}" ${fieldDisabled("worktreeName")}>
        </div>

        <div class="settings-field">
          <div class="settings-field-header">
            <span class="settings-label">Chrome</span>
            ${useGlobalCheckbox("chrome")}
          </div>
          <div class="settings-checkbox-row">
            <input type="checkbox" id="sv-chrome" ${chromeValue ? "checked" : ""} ${fieldDisabled("chrome")}>
            <label for="sv-chrome">Enable Chrome browser automation</label>
          </div>
        </div>

        <div class="settings-field">
          <div class="settings-field-header">
            <span class="settings-label">Additional Directories</span>
            ${useGlobalCheckbox("addDirs")}
          </div>
          <input type="text" class="settings-input" id="sv-add-dirs" placeholder="/path/to/dir1, /path/to/dir2" value="${escapeHtml(addDirsValue)}" ${fieldDisabled("addDirs")}>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Session Launch</div>
        <div class="settings-hint">Options that control how sessions are started.</div>

        <div class="settings-field">
          <div class="settings-field-header">
            <span class="settings-label">Pre-launch Command</span>
            ${useGlobalCheckbox("preLaunchCmd")}
          </div>
          <div class="settings-hint">Prepended to the claude command (e.g. "aws-vault exec profile --" or "source .env &&")</div>
          <input type="text" class="settings-input" id="sv-pre-launch" placeholder="e.g. aws-vault exec profile --" value="${escapeHtml(preLaunchValue)}" ${fieldDisabled("preLaunchCmd")}>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Application</div>
        <div class="settings-hint">Switchboard display and appearance settings.</div>

        ${
          !isProject
            ? `<div class="settings-field">
          <div class="settings-field-header">
            <span class="settings-label">Terminal Theme</span>
          </div>
          <select class="settings-select" id="sv-terminal-theme">
            ${Object.entries(TERMINAL_THEMES)
              .map(
                ([key, t]) =>
                  `<option value="${key}" ${themeValue === key ? "selected" : ""}>${escapeHtml(t.label)}</option>`,
              )
              .join("")}
          </select>
        </div>`
            : ""
        }

        <div class="settings-field">
          <div class="settings-field-header">
            <span class="settings-label">Max Visible Sessions</span>
            ${useGlobalCheckbox("visibleSessionCount")}
          </div>
          <div class="settings-hint">Show up to this many sessions before collapsing the rest behind "+N older"</div>
          <input type="number" class="settings-input" id="sv-visible-count" min="1" max="100" value="${visCountValue}" ${fieldDisabled("visibleSessionCount")}>
        </div>

        ${
          !isProject
            ? `<div class="settings-field">
          <div class="settings-field-header">
            <span class="settings-label">Hide Sessions Older Than (days)</span>
          </div>
          <div class="settings-hint">Sessions older than this are hidden behind "+N older" even if under the count limit</div>
          <input type="number" class="settings-input" id="sv-max-age" min="1" max="365" value="${maxAgeValue}">
        </div>`
            : ""
        }
      </div>

      <button class="settings-save-btn" id="sv-save-btn">Save Settings</button>
      ${isProject ? '<button class="settings-remove-btn" id="sv-remove-btn">Remove Project</button>' : ""}
    </div>
  `;

  // Use-global checkboxes toggle field disabled state
  for (const cb of settingsViewerBody.querySelectorAll(".use-global-cb")) {
    cb.addEventListener("change", () => {
      const field = cb.dataset.field;
      const _inputs = settingsViewerBody.querySelectorAll(
        `#sv-perm-mode, #sv-worktree, #sv-worktree-name, #sv-add-dirs, #sv-visible-count`,
      );
      // Map field name to input element
      const fieldMap = {
        permissionMode: "sv-perm-mode",
        worktree: "sv-worktree",
        worktreeName: "sv-worktree-name",
        chrome: "sv-chrome",
        preLaunchCmd: "sv-pre-launch",
        addDirs: "sv-add-dirs",
        visibleSessionCount: "sv-visible-count",
      };
      const input: HTMLInputElement | null = settingsViewerBody.querySelector(
        `#${fieldMap[field]}`,
      );
      if (input) input.disabled = (cb as HTMLInputElement).checked;
    });
  }

  // Save button
  settingsViewerBody
    .querySelector("#sv-save-btn")
    .addEventListener("click", async () => {
      const settings = {};

      if (isProject) {
        // Only save fields where "use global" is unchecked
        for (const cb of settingsViewerBody.querySelectorAll(
          ".use-global-cb",
        )) {
          if (!(cb as HTMLInputElement).checked) {
            const field: string | undefined = (cb as HTMLElement).dataset.field;
            const fieldMap: Record<string, () => unknown> = {
              permissionMode: () =>
                settingsViewerBody.querySelector("#sv-perm-mode").value || null,
              worktree: () =>
                settingsViewerBody.querySelector("#sv-worktree").checked,
              worktreeName: () =>
                settingsViewerBody
                  .querySelector("#sv-worktree-name")
                  .value.trim(),
              chrome: () =>
                settingsViewerBody.querySelector("#sv-chrome").checked,
              preLaunchCmd: () =>
                settingsViewerBody.querySelector("#sv-pre-launch").value.trim(),
              addDirs: () =>
                settingsViewerBody.querySelector("#sv-add-dirs").value.trim(),
              visibleSessionCount: () =>
                parseInt(
                  settingsViewerBody.querySelector("#sv-visible-count").value,
                  10,
                ) || 10,
            };
            if (field && fieldMap[field]) settings[field] = fieldMap[field]();
          }
        }
      } else {
        settings.permissionMode =
          settingsViewerBody.querySelector("#sv-perm-mode").value || null;
        settings.worktree =
          settingsViewerBody.querySelector("#sv-worktree").checked;
        settings.worktreeName = settingsViewerBody
          .querySelector("#sv-worktree-name")
          .value.trim();
        settings.chrome =
          settingsViewerBody.querySelector("#sv-chrome").checked;
        settings.preLaunchCmd = settingsViewerBody
          .querySelector("#sv-pre-launch")
          .value.trim();
        settings.addDirs = settingsViewerBody
          .querySelector("#sv-add-dirs")
          .value.trim();
        settings.visibleSessionCount =
          parseInt(
            settingsViewerBody.querySelector("#sv-visible-count").value,
            10,
          ) || 10;
        settings.sessionMaxAgeDays =
          parseInt(settingsViewerBody.querySelector("#sv-max-age").value, 10) ||
          3;
        settings.terminalTheme =
          settingsViewerBody.querySelector("#sv-terminal-theme").value ||
          "switchboard";
      }

      // Preserve windowBounds and sidebarWidth if they exist
      if (!isProject) {
        const existing = (await window.api.getSetting("global")) || {};
        if (existing.windowBounds)
          settings.windowBounds = existing.windowBounds;
        if (existing.sidebarWidth)
          settings.sidebarWidth = existing.sidebarWidth;
      }

      await window.api.setSetting(settingsKey, settings);

      // Update visibleSessionCount, sessionMaxAgeDays, and theme
      if (!isProject) {
        if (settings.visibleSessionCount)
          visibleSessionCount = settings.visibleSessionCount;
        if (settings.sessionMaxAgeDays)
          sessionMaxAgeDays = settings.sessionMaxAgeDays;
        if (settings.terminalTheme) {
          currentThemeName = settings.terminalTheme;
          TERMINAL_THEME = getTerminalTheme();
          // Apply to all open terminals
          for (const [, entry] of openSessions) {
            entry.terminal.options.theme = TERMINAL_THEME;
          }
        }
        renderProjects(showArchived ? cachedAllProjects : cachedProjects);
      }

      // Flash save confirmation
      const btn = settingsViewerBody.querySelector("#sv-save-btn");
      btn.classList.add("saved");
      btn.textContent = "Saved!";
      setTimeout(() => {
        btn.classList.remove("saved");
        btn.textContent = "Save Settings";
      }, 1500);
    });

  // Remove project button
  const removeBtn = settingsViewerBody.querySelector("#sv-remove-btn");
  if (removeBtn) {
    removeBtn.addEventListener("click", async () => {
      if (
        !confirm(
          `Remove project "${shortName}" from Switchboard?\n\nThis hides the project from the sidebar. Your session files are not deleted.`,
        )
      )
        return;
      await window.api.removeProject(projectPath);
      settingsViewer.style.display = "none";
      placeholder.style.display = "flex";
      void loadProjects();
    });
  }
}

// Global settings gear button
globalSettingsBtn.addEventListener("click", () => {
  void openSettingsViewer("global");
});

// Add project button
addProjectBtn.addEventListener("click", () => {
  showAddProjectDialog();
});

function showAddProjectDialog(): void {
  const overlay = document.createElement("div");
  overlay.className = "add-project-overlay";

  const dialog = document.createElement("div");
  dialog.className = "add-project-dialog";

  dialog.innerHTML = `
    <h3>Add Project</h3>
    <div class="add-project-hint">Select a folder to create a new project. To start a session in an existing project, use the + on its project header.</div>
    <div class="folder-input-row">
      <input type="text" id="add-project-path" placeholder="/path/to/project" autocomplete="off" spellcheck="false">
      <button class="add-project-browse-btn">Browse</button>
    </div>
    <div class="add-project-error" id="add-project-error"></div>
    <div class="add-project-actions">
      <button class="add-project-cancel-btn">Cancel</button>
      <button class="add-project-add-btn">Add</button>
    </div>
  `;

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const pathInput = dialog.querySelector("#add-project-path");
  const errorEl = dialog.querySelector("#add-project-error");
  pathInput.focus();

  function close(): void {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  }

  async function addProject(): Promise<void> {
    const projectPath: string = (pathInput as HTMLInputElement).value.trim();
    if (!projectPath) {
      errorEl.textContent = "Please enter a folder path.";
      errorEl.style.display = "block";
      return;
    }
    errorEl.style.display = "none";
    const result = await window.api.addProject(projectPath);
    if (result.error) {
      errorEl.textContent = result.error;
      errorEl.style.display = "block";
      return;
    }
    close();

    // Reload projects so the new one appears at the top (with fresh sort)
    lastProjectSortTime = 0;
    await loadProjects();
  }

  (dialog.querySelector(".add-project-browse-btn") as HTMLElement).onclick =
    async (): Promise<void> => {
      const folder: string | null = await window.api.browseFolder();
      if (folder) (pathInput as HTMLInputElement).value = folder;
    };

  dialog.querySelector(".add-project-cancel-btn").onclick = close;
  (dialog.querySelector(".add-project-add-btn") as HTMLElement).onclick =
    (): void => void addProject();
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") close();
    if (e.key === "Enter") void addProject();
  }
  document.addEventListener("keydown", onKey);
}

// --- Sidebar resize ---
{
  const sidebar = document.getElementById("sidebar");
  const handle = document.getElementById("sidebar-resize-handle");
  let dragging = false;

  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    dragging = true;
    handle.classList.add("dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const width = Math.min(600, Math.max(200, e.clientX));
    sidebar.style.width = `${width}px`;
  });

  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove("dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    // Refit active terminal
    if (activeSessionId && openSessions.has(activeSessionId)) {
      const entry = openSessions.get(activeSessionId);
      entry.fitAddon.fit();
      clearTimeout(resizeScrollActive);
      resizeScrollActive = setTimeout(() => {
        resizeScrollActive = null;
      }, 1000);
    }
    // Save sidebar width to settings
    const width = parseInt(sidebar.style.width, 10);
    if (width) {
      window.api.getSetting("global").then((g) => {
        const global = g || {};
        global.sidebarWidth = width;
        window.api.setSetting("global", global);
      });
    }
  });
}

// Warm up xterm.js renderer so first terminal open is fast
setTimeout(() => {
  const warmEl = document.createElement("div");
  warmEl.style.cssText =
    "position:absolute;left:-9999px;width:400px;height:200px;";
  document.body.appendChild(warmEl);
  const warmTerm = new Terminal({ cols: 80, rows: 10 });
  const warmFit = new FitAddon();
  warmTerm.loadAddon(warmFit);
  warmTerm.open(warmEl);
  warmTerm.write(" ");
  requestAnimationFrame(() => {
    warmTerm.dispose();
    warmEl.remove();
  });
}, 100);

// --- Terminal passthrough for intercepted shortcuts ---
window.api.onTerminalPassthrough((data) => {
  if (activeSessionId) window.api.sendInput(activeSessionId, data);
});

// --- Global keyboard shortcuts ---
document.addEventListener("keydown", (e) => {
  // Cmd+T: open new terminal in same project
  if ((e.metaKey || e.ctrlKey) && e.key === "t") {
    e.preventDefault();
    const entry = activeSessionId && openSessions.get(activeSessionId);
    const projectPath = entry?.session?.projectPath;
    if (!projectPath) return;
    const project = cachedAllProjects.find(
      (p) => p.projectPath === projectPath,
    );
    if (project) void launchTerminalSession(project);
  }
});

// --- Init: restore settings ---
void (async (): Promise<void> => {
  // biome-ignore lint/suspicious/noExplicitAny: settings shape is dynamic
  const globalSetting: any = await window.api.getSetting("global");
  if (globalSetting) {
    if (globalSetting.sidebarWidth) {
      document.getElementById("sidebar").style.width =
        `${globalSetting.sidebarWidth}px`;
    }
    if (globalSetting.visibleSessionCount) {
      visibleSessionCount = globalSetting.visibleSessionCount;
    }
    if (globalSetting.sessionMaxAgeDays) {
      sessionMaxAgeDays = globalSetting.sessionMaxAgeDays;
    }
    if (
      globalSetting.terminalTheme &&
      TERMINAL_THEMES[globalSetting.terminalTheme]
    ) {
      currentThemeName = globalSetting.terminalTheme;
      TERMINAL_THEME = getTerminalTheme();
    }
  }
})();

void loadProjects().then(() => {
  // Restore active session after reload
  if (activeSessionId && !openSessions.has(activeSessionId)) {
    const session: SessionObj | undefined = sessionMap.get(activeSessionId);
    if (session) void openSession(session);
  }
});

// Live-reload sidebar when filesystem changes are detected
let projectsChangedTimer: ReturnType<typeof setTimeout> | null = null;
let projectsChangedWhileAway: boolean = false;
window.api.onProjectsChanged(() => {
  // Debounce to avoid rapid re-renders during bulk changes
  if (projectsChangedTimer) clearTimeout(projectsChangedTimer);
  if (activeTab !== "sessions") {
    projectsChangedWhileAway = true;
    return;
  }
  projectsChangedTimer = setTimeout(() => {
    projectsChangedTimer = null;
    void loadProjects();
  }, 300);
});

// Status bar
let activityTimer: ReturnType<typeof setTimeout> | null = null;

function renderDefaultStatus(): void {
  const totalSessions = cachedAllProjects.reduce(
    (n, p) => n + p.sessions.length,
    0,
  );
  const totalProjects = cachedAllProjects.length;
  const running = activePtyIds.size;
  const parts: string[] = [];
  if (running > 0) parts.push(`${running} running`);
  parts.push(`${totalSessions} sessions`);
  parts.push(`${totalProjects} projects`);
  statusBarInfo.textContent = parts.join(" \u00b7 ");
}

window.api.onStatusUpdate((text, type) => {
  if (activityTimer) clearTimeout(activityTimer);
  statusBarActivity.textContent = text;
  statusBarActivity.className = type === "done" ? "status-done" : "";
  if (!text || type === "done") {
    activityTimer = setTimeout(
      () => {
        statusBarActivity.textContent = "";
        statusBarActivity.className = "";
      },
      type === "done" ? 3000 : 0,
    );
  }
});

// --- Auto-update status + toast ---
const statusBarUpdater: HTMLElement | null =
  document.getElementById("status-bar-updater");
let updaterStatusTimer: ReturnType<typeof setTimeout> | null = null;
function setUpdaterStatus(text: string, duration?: number): void {
  if (updaterStatusTimer) clearTimeout(updaterStatusTimer);
  statusBarUpdater.textContent = text;
  if (duration) {
    updaterStatusTimer = setTimeout(() => {
      statusBarUpdater.textContent = "";
    }, duration);
  }
}
// biome-ignore lint/suspicious/noExplicitAny: updater event data has dynamic shape
// biome-ignore lint/nursery/useExplicitType: data parameter requires any for dynamic updater events
const updaterHandler = (type: string, data: any): void => {
  switch (type) {
    case "checking":
      setUpdaterStatus("Checking for updates…");
      break;
    case "update-available":
      setUpdaterStatus(`Downloading v${data.version}…`);
      break;
    case "update-not-available":
      setUpdaterStatus("Up to date", 3000);
      break;
    case "download-progress":
      setUpdaterStatus(`Updating… ${Math.round(data.percent)}%`);
      break;
    case "update-downloaded": {
      setUpdaterStatus(`v${data.version} ready — restart to update`);
      const dismissed = localStorage.getItem("update-dismissed");
      if (dismissed === data.version) return;
      const toast = document.getElementById("update-toast");
      const msg = document.getElementById("update-toast-msg");
      msg.innerHTML = `New Version Ready<br><span class="update-version">v${data.version}</span>`;
      toast.classList.remove("hidden");
      document.getElementById("update-restart-btn").onclick = (): void => {
        void window.api.updaterInstall();
      };
      document.getElementById("update-dismiss-btn").onclick = (): void => {
        toast.classList.add("hidden");
        localStorage.setItem("update-dismissed", data.version);
      };
      break;
    }
    case "error":
      setUpdaterStatus("Update check failed", 5000);
      break;
  }
};
window.api.onUpdaterEvent(updaterHandler);
