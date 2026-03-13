import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import {
  activePtyIds,
  activeSessionId,
  attentionSessions,
  cachedAllProjects,
  cachedProjects,
  lastActivityTime,
  openSessions,
  pendingSessions,
  placeholder,
  type SessionObj,
  sessionMap,
  sessionProgressState,
  setActivePtyIds,
  setActiveSession,
  showArchived,
  terminalHeader,
  terminalHeaderId,
  terminalHeaderName,
  terminalHeaderPtyTitle,
  terminalHeaderStatus,
  terminalStopBtn,
  unreadNoiseRe,
  unreadSessions,
} from "./state";
import { cleanDisplayName } from "./utils";

// --- Escape sequence constants ---
// Synchronized output markers — TUI repaints, not meaningful content
const ESC_SYNC_START: string = "\x1b[?2026h";
const ESC_SYNC_END: string = "\x1b[?2026l";

// Terminal escape sequences
const ESC_SCREEN_CLEAR: string = "\x1b[2J";
const ESC_ALT_SCREEN_ON: string = "\x1b[?1049h";

// Scroll-to-bottom window: activated by resize or large redraws,
// then write callbacks keep scrolling until the window expires.
let redrawScrollActive: ReturnType<typeof setTimeout> | null = null;

// Resize: fit immediately, scroll to bottom as PTY re-render data arrives
export let resizeScrollActive: ReturnType<typeof setTimeout> | null = null;
export function setResizeScrollActive(
  v: ReturnType<typeof setTimeout> | null,
): void {
  resizeScrollActive = v;
}

// --- Terminal key handler: send modifier+key combos as kitty protocol sequences ---
export function attachTerminalKeyHandler(
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

// --- Unread/activity tracking ---
export function markUnread(sessionId: string, data: string): void {
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

export function clearUnread(sessionId: string): void {
  unreadSessions.delete(sessionId);
  const item: Element | null = document.querySelector(
    `.session-item[data-session-id="${sessionId}"]`,
  );
  if (item) item.classList.remove("has-unread");
}

// --- Progress indicators ---
export function updateProgressIndicators(sessionId: string): void {
  const info = sessionProgressState.get(sessionId);
  const state: number = info?.state ?? 0;

  // Update sidebar item
  const item: Element | null = document.querySelector(
    `.session-item[data-session-id="${sessionId}"]`,
  );
  if (item) {
    item.classList.toggle("is-busy", state === 3);
    item.classList.toggle("has-progress", state === 1);
    item.classList.toggle("has-error", state === 2);
  }

  // Update terminal header progress bar if this is the active session
  if (sessionId === activeSessionId) {
    const bar: HTMLElement | null = document.getElementById(
      "terminal-progress-bar",
    );
    if (!bar) return;
    bar.className = `progress-state-${state}`;
    if (state === 1) {
      bar.style.setProperty("--progress", `${info?.percent || 0}%`);
    }
  }
}

// --- Running indicators ---
export function updateRunningIndicators(): void {
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

// --- Terminal header ---
export function updateTerminalHeader(): void {
  if (!activeSessionId) return;
  const running: boolean = activePtyIds.has(activeSessionId);
  terminalHeaderStatus.className = running ? "running" : "stopped";
  terminalHeaderStatus.textContent = running ? "Running" : "Stopped";
  terminalStopBtn.style.display = running ? "" : "none";
  updatePtyTitle();
}

export function updatePtyTitle(): void {
  if (!(activeSessionId && terminalHeaderPtyTitle)) return;
  const entry = openSessions.get(activeSessionId);
  const title: string = entry?.ptyTitle || "";
  terminalHeaderPtyTitle.textContent = title;
  terminalHeaderPtyTitle.style.display = title ? "" : "none";
}

export function showTerminalHeader(session: SessionObj): void {
  const displayName: string = cleanDisplayName(session.name || session.summary);
  terminalHeaderName.textContent = displayName;
  terminalHeaderId.textContent = session.sessionId;
  terminalHeader.style.display = "";
  updateTerminalHeader();
  updateProgressIndicators(session.sessionId);
}

// --- Poll for active PTY sessions ---
export async function pollActiveSessions(): Promise<void> {
  try {
    const ids: string[] = await window.api.getActiveSessions();
    setActivePtyIds(new Set(ids));
    updateRunningIndicators();
    updateTerminalHeader();
  } catch (e: unknown) {
    window.api.logWarn(`[pollActiveSessions] failed: ${(e as Error).message}`);
  }
}

// --- IPC listeners from main process ---
export function initTerminalListeners(
  loadProjectsFn: () => Promise<void>,
  renderProjectsFn: (projects: SessionObj[], isSearch?: boolean) => void,
): void {
  window.api.onTerminalData((sessionId: string, data: string) => {
    const entry = openSessions.get(sessionId);
    if (entry) {
      // Detect full redraws and activate scroll window (same approach as resize)
      // Only scan for escape sequences in chunks that contain ESC[
      if (
        sessionId === activeSessionId &&
        data.length > 3 &&
        data.includes("\x1b[")
      ) {
        if (
          data.includes(ESC_SCREEN_CLEAR) ||
          data.includes(ESC_ALT_SCREEN_ON)
        ) {
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
    const isSyncRedraw: boolean =
      data.startsWith(ESC_SYNC_START) && data.endsWith(ESC_SYNC_END);
    if (!isSyncRedraw) {
      if (!unreadNoiseRe.test(data))
        lastActivityTime.set(sessionId, new Date());
      markUnread(sessionId, data);
    }
  });

  window.api.onSessionForked((oldId: string, newId: string) => {
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

    void loadProjectsFn().then(() => {
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

  window.api.onProcessExited((sessionId: string, _exitCode: number) => {
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
          proj.sessions = proj.sessions.filter(
            (s: SessionObj) => s.sessionId !== sessionId,
          );
        }
      }
      sessionMap.delete(sessionId);
      renderProjectsFn(showArchived ? cachedAllProjects : cachedProjects);
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
      renderProjectsFn(showArchived ? cachedAllProjects : cachedProjects);
    }

    void pollActiveSessions();
  });

  // --- Terminal notifications (iTerm2 OSC 9 — "needs attention") ---
  window.api.onTerminalNotification((sessionId: string, message: string) => {
    // Only mark as needing attention for "attention" messages, not "waiting for input"
    if (
      /attention|approval|permission|needs your/i.test(message) &&
      sessionId !== activeSessionId
    ) {
      attentionSessions.add(sessionId);
      const item: Element | null = document.querySelector(
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
  window.api.onProgressState(
    (sessionId: string, state: number, percent: number) => {
      sessionProgressState.set(sessionId, { state, percent });
      updateProgressIndicators(sessionId);
    },
  );

  // --- Terminal passthrough for intercepted shortcuts ---
  window.api.onTerminalPassthrough((data: unknown) => {
    if (activeSessionId) window.api.sendInput(activeSessionId, data as string);
  });
}

// --- Warm up xterm.js renderer so first terminal open is fast ---
export function warmUpXterm(): void {
  setTimeout(() => {
    const warmEl: HTMLDivElement = document.createElement("div");
    warmEl.style.cssText =
      "position:absolute;left:-9999px;width:400px;height:200px;";
    document.body.appendChild(warmEl);
    const warmTerm: Terminal = new Terminal({ cols: 80, rows: 10 });
    const warmFit: FitAddon = new FitAddon();
    warmTerm.loadAddon(warmFit);
    warmTerm.open(warmEl);
    warmTerm.write(" ");
    requestAnimationFrame(() => {
      warmTerm.dispose();
      warmEl.remove();
    });
  }, 100);
}
