import "@xterm/xterm/css/xterm.css";
import "./style.css";

import {
  forkSession,
  launchTerminalSession,
  openSession,
  showNewSessionPopover,
} from "./session-actions";
import {
  loadProjects,
  rebindSidebarEvents,
  renderProjects,
  resetSortDebouncing,
  setLastProjectSortTime,
} from "./sidebar";
import {
  activePtyIds,
  activeSessionId,
  activeTab,
  addProjectBtn,
  archiveToggle,
  cachedAllProjects,
  cachedMemories,
  cachedPlans,
  cachedProjects,
  globalSettingsBtn,
  lastActivityTime,
  memoryContent,
  memoryViewer,
  openSessions,
  type ProjectObj,
  placeholder,
  plansContent,
  planViewer,
  runningToggle,
  type SessionObj,
  searchBar,
  searchInput,
  sessionFilters,
  sessionMap,
  setActiveSession,
  setActiveTab,
  setCurrentThemeName,
  setSessionMaxAgeDays,
  setShowArchived,
  setShowRunningOnly,
  setShowStarredOnly,
  setShowTodayOnly,
  settingsViewer,
  setVisibleSessionCount,
  showArchived,
  showRunningOnly,
  showStarredOnly,
  showTodayOnly,
  sidebarContent,
  starToggle,
  statsContent,
  statsViewer,
  statusBarActivity,
  statusBarInfo,
  statusBarUpdater,
  terminalArea,
  terminalHeader,
  terminalRestartBtn,
  terminalStopBtn,
  todayToggle,
} from "./state";
import {
  initTerminalListeners,
  pollActiveSessions,
  resizeScrollActive,
  setResizeScrollActive,
  warmUpXterm,
} from "./terminal";
import { TERMINAL_THEMES } from "./themes";
import { formatDate } from "./utils";
import {
  hideAllViewers,
  initPlanToolbar,
  loadMemories,
  loadPlans,
  loadStats,
  openSettingsViewer,
  renderMemories,
  renderPlans,
  showJsonlViewer,
} from "./viewers";

// --- Sidebar event callbacks (avoids circular deps) ---
function getSidebarCallbacks(): Parameters<typeof rebindSidebarEvents>[1] {
  return {
    openSession: (session: SessionObj): void => {
      void openSession(session);
    },
    showNewSessionPopover,
    openSettingsViewer: (scope: string, projectPath?: string): Promise<void> =>
      openSettingsViewer(scope, projectPath, {
        loadProjects: doLoadProjects,
        renderProjects: doRenderAndRebind,
      }),
    showJsonlViewer,
    forkSession,
    loadProjects: doLoadProjects,
  };
}

function doRenderAndRebind(projects: ProjectObj[], isSearch?: boolean): void {
  renderProjects(projects, isSearch);
  rebindSidebarEvents(projects, getSidebarCallbacks());
}

function renderDefaultStatus(): void {
  const totalSessions: number = cachedAllProjects.reduce(
    (n: number, p: ProjectObj) => n + p.sessions.length,
    0,
  );
  const totalProjects: number = cachedAllProjects.length;
  const running: number = activePtyIds.size;
  const parts: string[] = [];
  if (running > 0) parts.push(`${running} running`);
  parts.push(`${totalSessions} sessions`);
  parts.push(`${totalProjects} projects`);
  statusBarInfo.textContent = parts.join(" \u00b7 ");
}

async function doLoadProjects(): Promise<void> {
  await loadProjects(
    renderDefaultStatus,
    doRenderAndRebind,
    getSidebarCallbacks(),
  );
}

// --- Init terminal IPC listeners ---
initTerminalListeners(doLoadProjects, doRenderAndRebind);

// --- Plan toolbar ---
initPlanToolbar();

// --- Filter toggle helpers ---
archiveToggle.addEventListener("click", () => {
  setShowArchived(!showArchived);
  archiveToggle.classList.toggle("active", showArchived);
  resetSortDebouncing();
  doRenderAndRebind(showArchived ? cachedAllProjects : cachedProjects);
});

starToggle.addEventListener("click", () => {
  setShowStarredOnly(!showStarredOnly);
  if (showStarredOnly) {
    setShowRunningOnly(false);
    runningToggle.classList.remove("active");
  }
  starToggle.classList.toggle("active", showStarredOnly);
  resetSortDebouncing();
  doRenderAndRebind(showArchived ? cachedAllProjects : cachedProjects);
});

runningToggle.addEventListener("click", () => {
  setShowRunningOnly(!showRunningOnly);
  if (showRunningOnly) {
    setShowStarredOnly(false);
    starToggle.classList.remove("active");
  }
  runningToggle.classList.toggle("active", showRunningOnly);
  resetSortDebouncing();
  doRenderAndRebind(showArchived ? cachedAllProjects : cachedProjects);
});

todayToggle.addEventListener("click", () => {
  setShowTodayOnly(!showTodayOnly);
  todayToggle.classList.toggle("active", showTodayOnly);
  resetSortDebouncing();
  doRenderAndRebind(showArchived ? cachedAllProjects : cachedProjects);
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
    doRenderAndRebind(showArchived ? cachedAllProjects : cachedProjects);
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
    const query: string = searchInput.value.trim();

    if (!query) {
      clearSearch();
      return;
    }

    try {
      if (activeTab === "sessions") {
        const results = await window.api.search("session", query);
        const matchIds: Set<string> = new Set(results.map((r) => r.id));
        // Always search all projects (including archived) so no results are hidden
        const filtered: ProjectObj[] = cachedAllProjects
          .map((p: ProjectObj) => ({
            ...p,
            sessions: p.sessions.filter((s: SessionObj) =>
              matchIds.has(s.sessionId),
            ),
          }))
          .filter((p: ProjectObj) => p.sessions.length > 0);
        doRenderAndRebind(filtered, true);
      } else if (activeTab === "plans") {
        const results = await window.api.search("plan", query);
        const matchIds: Set<string> = new Set(results.map((r) => r.id));
        renderPlans(
          cachedPlans.filter((p: ProjectObj) => matchIds.has(p.filename)),
        );
      } else if (activeTab === "memory") {
        const results = await window.api.search("memory", query);
        const matchIds: Set<string> = new Set(results.map((r) => r.id));
        renderMemories(
          cachedMemories.filter((m: ProjectObj) => matchIds.has(m.filePath)),
        );
      }
    } catch (e: unknown) {
      window.api.logWarn(`[search] failed: ${(e as Error).message}`);
      // Fallback to showing all on error
      if (activeTab === "sessions") {
        doRenderAndRebind(showArchived ? cachedAllProjects : cachedProjects);
      }
    }
  }, 200);
});

// --- Terminal header controls ---
terminalStopBtn.addEventListener("click", async () => {
  if (!activeSessionId) return;
  const sid: string = activeSessionId;
  await window.api.stopSession(sid);
  activePtyIds.delete(sid);
  setActiveSession(null);
  terminalHeader.style.display = "none";
  placeholder.style.display = "";
  doRenderAndRebind(showArchived ? cachedAllProjects : cachedProjects);
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

// --- Tab switching ---
for (const tab of document.querySelectorAll(".sidebar-tab")) {
  tab.addEventListener("click", () => {
    const tabName: string | undefined = (tab as HTMLElement).dataset.tab;
    if (tabName === activeTab) return;
    setActiveTab(tabName || "sessions");
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
        void doLoadProjects();
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

// --- Global settings gear button ---
globalSettingsBtn.addEventListener("click", () => {
  void openSettingsViewer("global", undefined, {
    loadProjects: doLoadProjects,
    renderProjects: doRenderAndRebind,
  });
});

// --- Add project button ---
addProjectBtn.addEventListener("click", () => {
  showAddProjectDialog();
});

function showAddProjectDialog(): void {
  const overlay: HTMLDivElement = document.createElement("div");
  overlay.className = "add-project-overlay";

  const dialog: HTMLDivElement = document.createElement("div");
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

  const pathInput: Element | null = dialog.querySelector("#add-project-path");
  const errorEl: Element | null = dialog.querySelector("#add-project-error");
  (pathInput as HTMLInputElement).focus();

  function close(): void {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  }

  async function addProject(): Promise<void> {
    const projectPath: string = (pathInput as HTMLInputElement).value.trim();
    if (!projectPath) {
      errorEl.textContent = "Please enter a folder path.";
      (errorEl as HTMLElement).style.display = "block";
      return;
    }
    (errorEl as HTMLElement).style.display = "none";
    const result = await window.api.addProject(projectPath);
    if (result.error) {
      errorEl.textContent = result.error;
      (errorEl as HTMLElement).style.display = "block";
      return;
    }
    close();

    // Reload projects so the new one appears at the top (with fresh sort)
    setLastProjectSortTime(0);
    await doLoadProjects();
  }

  (dialog.querySelector(".add-project-browse-btn") as HTMLElement).onclick =
    async (): Promise<void> => {
      const folder: string | null = await window.api.browseFolder();
      if (folder) (pathInput as HTMLInputElement).value = folder;
    };

  (dialog.querySelector(".add-project-cancel-btn") as HTMLElement).onclick =
    close;
  (dialog.querySelector(".add-project-add-btn") as HTMLElement).onclick =
    (): void => void addProject();
  overlay.addEventListener("click", (e: Event) => {
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
  const sidebar: HTMLElement | null = document.getElementById("sidebar");
  const handle: HTMLElement | null = document.getElementById(
    "sidebar-resize-handle",
  );
  let dragging: boolean = false;

  handle.addEventListener("mousedown", (e: MouseEvent) => {
    e.preventDefault();
    dragging = true;
    handle.classList.add("dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  });

  window.addEventListener("mousemove", (e: MouseEvent) => {
    if (!dragging) return;
    const width: number = Math.min(600, Math.max(200, e.clientX));
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
      setResizeScrollActive(
        setTimeout(() => {
          setResizeScrollActive(null);
        }, 1000),
      );
    }
    // Save sidebar width to settings
    const width: number = parseInt(sidebar.style.width, 10);
    if (width) {
      void window.api.getSetting("global").then((g: unknown) => {
        // biome-ignore lint/suspicious/noExplicitAny: settings shape is dynamic
        const global: any = g || {};
        global.sidebarWidth = width;
        void window.api.setSetting("global", global);
      });
    }
  });
}

// Handle window resize
window.addEventListener("resize", () => {
  if (activeSessionId && openSessions.has(activeSessionId)) {
    const entry = openSessions.get(activeSessionId);
    entry.fitAddon.fit();
    clearTimeout(resizeScrollActive);
    setResizeScrollActive(
      setTimeout(() => {
        setResizeScrollActive(null);
      }, 1000),
    );
  }
});

// Warm up xterm.js renderer so first terminal open is fast
warmUpXterm();

// --- Global keyboard shortcuts ---
document.addEventListener("keydown", (e: KeyboardEvent) => {
  // Cmd+T: open new terminal in same project
  if ((e.metaKey || e.ctrlKey) && e.key === "t") {
    e.preventDefault();
    const entry = activeSessionId && openSessions.get(activeSessionId);
    const projectPath: string | undefined = entry?.session?.projectPath;
    if (!projectPath) return;
    const project: ProjectObj | undefined = cachedAllProjects.find(
      (p: ProjectObj) => p.projectPath === projectPath,
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
      setVisibleSessionCount(globalSetting.visibleSessionCount);
    }
    if (globalSetting.sessionMaxAgeDays) {
      setSessionMaxAgeDays(globalSetting.sessionMaxAgeDays);
    }
    if (
      globalSetting.terminalTheme &&
      TERMINAL_THEMES[globalSetting.terminalTheme]
    ) {
      setCurrentThemeName(globalSetting.terminalTheme);
    }
  }
})();

void doLoadProjects().then(() => {
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
    void doLoadProjects();
  }, 300);
});

// Refresh sidebar timeago labels every 30s so "just now" ticks forward
setInterval(() => {
  for (const [sessionId, time] of lastActivityTime) {
    const item: HTMLElement | null = document.getElementById(`si-${sessionId}`);
    if (!item) continue;
    const meta: Element | null = item.querySelector(".session-meta");
    if (!meta) continue;
    const session: SessionObj | undefined = sessionMap.get(sessionId);
    const msgSuffix: string = session?.messageCount
      ? ` \u00b7 ${session.messageCount} msgs`
      : "";
    meta.textContent = formatDate(time) + msgSuffix;
  }
}, 30000);

// Poll for active sessions periodically
setInterval(() => void pollActiveSessions(), 3000);

// --- Status bar ---
let activityTimer: ReturnType<typeof setTimeout> | null = null;

window.api.onStatusUpdate((text: string, type: string) => {
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
      setUpdaterStatus("Checking for updates\u2026");
      break;
    case "update-available":
      setUpdaterStatus(`Downloading v${data.version}\u2026`);
      break;
    case "update-not-available":
      setUpdaterStatus("Up to date", 3000);
      break;
    case "download-progress":
      setUpdaterStatus(`Updating\u2026 ${Math.round(data.percent)}%`);
      break;
    case "update-downloaded": {
      setUpdaterStatus(`v${data.version} ready \u2014 restart to update`);
      const dismissed: string | null = localStorage.getItem("update-dismissed");
      if (dismissed === data.version) return;
      const toast: HTMLElement | null = document.getElementById("update-toast");
      const msg: HTMLElement | null =
        document.getElementById("update-toast-msg");
      msg.innerHTML = `New Version Ready<br><span class="update-version">v${data.version}</span>`;
      toast.classList.remove("hidden");
      (document.getElementById("update-restart-btn") as HTMLElement).onclick =
        (): void => {
          void window.api.updaterInstall();
        };
      (document.getElementById("update-dismiss-btn") as HTMLElement).onclick =
        (): void => {
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

// --- Window controls (frameless) ---
document
  .getElementById("win-minimize")
  ?.addEventListener("click", () => window.api.windowMinimize());
document
  .getElementById("win-maximize")
  ?.addEventListener("click", () => window.api.windowMaximize());
document
  .getElementById("win-close")
  ?.addEventListener("click", () => window.api.windowClose());

// --- Zoom controls ---
const zoomResetBtn: HTMLElement | null = document.getElementById("zoom-reset");

function zoomLevelToPercent(level: number): number {
  return Math.round(100 * 1.2 ** level);
}

async function updateZoomDisplay(): Promise<void> {
  const level: number = await window.api.zoomGet();
  if (zoomResetBtn) zoomResetBtn.textContent = `${zoomLevelToPercent(level)}%`;
}

document.getElementById("zoom-in")?.addEventListener("click", async () => {
  const level: number = await window.api.zoomGet();
  await window.api.zoomSet(level + 1);
  void updateZoomDisplay();
});

document.getElementById("zoom-out")?.addEventListener("click", async () => {
  const level: number = await window.api.zoomGet();
  await window.api.zoomSet(level - 1);
  void updateZoomDisplay();
});

zoomResetBtn?.addEventListener("click", async () => {
  await window.api.zoomSet(0);
  void updateZoomDisplay();
});

void updateZoomDisplay();
