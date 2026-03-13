import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import {
  activeSessionId,
  attentionSessions,
  cachedAllProjects,
  cachedProjects,
  openSessions,
  type ProjectObj,
  pendingSessions,
  placeholder,
  type SessionObj,
  sessionMap,
  setActiveSession,
  showArchived,
  TERMINAL_THEME,
  terminalsEl,
} from "./state";
import {
  attachTerminalKeyHandler,
  clearUnread,
  markUnread,
  pollActiveSessions,
  showTerminalHeader,
  updatePtyTitle,
} from "./terminal";
import { escapeHtml } from "./utils";
import { hidePlanViewer } from "./viewers";

export async function resolveDefaultSessionOptions(
  project: ProjectObj,
): Promise<Record<string, unknown>> {
  const effective = await window.api.getEffectiveSettings(project.projectPath);
  const options: Record<string, unknown> = {};
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

export async function forkSession(
  session: SessionObj,
  project: ProjectObj,
): Promise<void> {
  const options: Record<string, unknown> =
    await resolveDefaultSessionOptions(project);
  options.forkFrom = session.sessionId;
  void launchNewSession(project, options);
}

export async function launchNewSession(
  project: ProjectObj,
  sessionOptions?: Record<string, unknown>,
): Promise<void> {
  const sessionId: string = crypto.randomUUID();
  const projectPath: string = project.projectPath;
  const session: SessionObj = {
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
  const folder: string = projectPath.replace(/[/_]/g, "-").replace(/^-/, "-");
  pendingSessions.set(sessionId, { session, projectPath, folder });

  // Inject into cached project data so it appears in sidebar immediately
  sessionMap.set(sessionId, session);
  for (const projList of [cachedProjects, cachedAllProjects]) {
    let proj: ProjectObj | undefined = projList.find(
      (p: ProjectObj) => p.projectPath === projectPath,
    );
    if (!proj) {
      proj = { folder, projectPath, sessions: [] };
      projList.unshift(proj);
    }
    proj.sessions.unshift(session);
  }
  // Import renderProjects to trigger sidebar re-render
  const { renderProjects } = await import("./sidebar");
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
export function _openNewSession(project: ProjectObj): Promise<void> {
  return launchNewSession(project);
}

export async function openSession(session: SessionObj): Promise<void> {
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
  const attentionItem: Element | null = document.querySelector(
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
  const resumeOptions: Record<string, unknown> =
    await resolveDefaultSessionOptions({ projectPath });
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

export async function launchTerminalSession(
  project: ProjectObj,
): Promise<void> {
  const sessionId: string = crypto.randomUUID();
  const projectPath: string = project.projectPath;
  const session: SessionObj = {
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
  const folder: string = projectPath.replace(/[/_]/g, "-").replace(/^-/, "-");
  pendingSessions.set(sessionId, { session, projectPath, folder });

  // Inject into cached project data
  sessionMap.set(sessionId, session);
  for (const projList of [cachedProjects, cachedAllProjects]) {
    let proj: ProjectObj | undefined = projList.find(
      (p: ProjectObj) => p.projectPath === projectPath,
    );
    if (!proj) {
      proj = { folder, projectPath, sessions: [] };
      projList.unshift(proj);
    }
    proj.sessions.unshift(session);
  }
  const { renderProjects } = await import("./sidebar");
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

export function showNewSessionPopover(
  project: ProjectObj,
  anchorEl: Element,
): void {
  // Remove any existing popover
  for (const el of document.querySelectorAll(".new-session-popover")) {
    el.remove();
  }

  const popover: HTMLDivElement = document.createElement("div");
  popover.className = "new-session-popover";

  const claudeBtn: HTMLButtonElement = document.createElement("button");
  claudeBtn.className = "popover-option";
  claudeBtn.innerHTML =
    '<img src="https://claude.ai/favicon.ico" class="popover-option-icon claude-icon" alt=""> Claude';
  claudeBtn.onclick = async (): Promise<void> => {
    popover.remove();
    void launchNewSession(project, await resolveDefaultSessionOptions(project));
  };

  const claudeOptsBtn: HTMLButtonElement = document.createElement("button");
  claudeOptsBtn.className = "popover-option";
  claudeOptsBtn.innerHTML =
    '<img src="https://claude.ai/favicon.ico" class="popover-option-icon claude-icon" alt=""> Claude (Configure...)';
  claudeOptsBtn.onclick = (): void => {
    popover.remove();
    void showNewSessionDialog(project);
  };

  const termBtn: HTMLButtonElement = document.createElement("button");
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
  const rect: DOMRect = anchorEl.getBoundingClientRect();
  const popoverHeight: number = popover.offsetHeight;
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

export async function showNewSessionDialog(project: ProjectObj): Promise<void> {
  const effective = await window.api.getEffectiveSettings(project.projectPath);

  const overlay: HTMLDivElement = document.createElement("div");
  overlay.className = "new-session-overlay";

  const dialog: HTMLDivElement = document.createElement("div");
  dialog.className = "new-session-dialog";

  let selectedMode: string | null = effective.permissionMode || null;
  let dangerousSkip: boolean = effective.dangerouslySkipPermissions;

  const modes: { value: string | null; label: string; desc: string }[] = [
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
          const isSelected: boolean =
            !dangerousSkip && selectedMode === m.value;
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
  const modeGrid: Element | null = dialog.querySelector("#nsd-mode-grid");
  modeGrid.addEventListener("click", (e: Event) => {
    const btn: Element | null = (e.target as HTMLElement).closest(
      ".permission-option",
    );
    if (!btn) return;
    const mode: string | undefined = (btn as HTMLElement).dataset.mode;
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

  (dialog.querySelector(".new-session-cancel-btn") as HTMLElement).onclick =
    close;
  (dialog.querySelector(".new-session-start-btn") as HTMLElement).onclick =
    start;
  overlay.addEventListener("click", (e: Event) => {
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
