import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  app,
  BrowserWindow,
  shell as electronShell,
  ipcMain,
  Menu,
  screen,
} from "electron";
import log from "electron-log";
import { setupAutoUpdater } from "./auto-updater";
import { PROJECTS_DIR } from "./constants";
import {
  deleteCachedFolder,
  deleteSearchFolder,
  getSetting,
  setSetting,
} from "./db";
import { detectSessionTransitions } from "./fork-detection";
import { registerIpcHandlers } from "./ipc-handlers";
import { activeSessions, registerPtyHandlers, warmupPty } from "./pty-manager";
import { refreshFolder } from "./session-scanner";

log.transports.file.level = app.isPackaged ? "info" : "debug";
log.transports.console.level = app.isPackaged ? "info" : "debug";

process.on("uncaughtException", (err) => {
  log.error("[uncaughtException]", err);
});
process.on("unhandledRejection", (reason) => {
  log.error("[unhandledRejection]", reason);
});

let mainWindow: BrowserWindow | null = null;

function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

// --- Auto-updater ---
const autoUpdater: import("electron-updater").AppUpdater | null =
  setupAutoUpdater(getMainWindow);

function createWindow(): void {
  // Restore saved window bounds
  const savedBounds = (getSetting("global") as Record<string, unknown> | null)
    ?.windowBounds as Record<string, number> | undefined;
  const bounds = { width: 1400, height: 900 };

  let restorePosition: { x: number; y: number } | null = null;
  if (savedBounds?.width && savedBounds.height) {
    bounds.width = savedBounds.width;
    bounds.height = savedBounds.height;

    // Only restore position if it's on a visible display
    if (savedBounds.x != null && savedBounds.y != null) {
      const displays = screen.getAllDisplays();
      const onScreen = displays.some((d) => {
        const b = d.bounds;
        return (
          savedBounds.x >= b.x - 100 &&
          savedBounds.x < b.x + b.width &&
          savedBounds.y >= b.y - 100 &&
          savedBounds.y < b.y + b.height
        );
      });
      if (onScreen) {
        restorePosition = { x: savedBounds.x, y: savedBounds.y };
      }
    }
  }

  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 800,
    minHeight: 500,
    title: "Switchboard",
    icon: path.join(__dirname, "../../build/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Set position after creation to prevent macOS from clamping size
  if (restorePosition) {
    mainWindow.setBounds({
      ...restorePosition,
      width: bounds.width,
      height: bounds.height,
    });
  }

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  // Open external links in the system browser instead of a child BrowserWindow
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void electronShell.openExternal(url);
    return { action: "deny" as const };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (mainWindow && url !== mainWindow.webContents.getURL()) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) void electronShell.openExternal(url);
    }
  });
  // Override window.open so xterm WebLinksAddon's default handler (which does
  // window.open() then sets location.href) routes through our IPC instead of
  // creating a child BrowserWindow.
  mainWindow.webContents.on("did-finish-load", () => {
    if (!mainWindow) return;
    void mainWindow.webContents.executeJavaScript(`
      window.open = function(url) {
        if (url && /^https?:\\/\\//i.test(url)) { window.api.openExternal(url); return null; }
        const proxy = {};
        Object.defineProperty(proxy, 'location', { get() {
          const loc = {};
          Object.defineProperty(loc, 'href', {
            set(u) { if (/^https?:\\/\\//i.test(u)) window.api.openExternal(u); }
          });
          return loc;
        }});
        return proxy;
      };
      void 0;
    `);
  });

  // Prevent Cmd+R / Ctrl+Shift+R from reloading the page (Chromium built-in).
  // Ctrl+R alone on macOS is NOT a reload shortcut and must pass through to xterm
  // for reverse-i-search.
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const key = input.key.toLowerCase();
    if (key === "r" && input.meta) event.preventDefault();
    if (key === "r" && input.control && input.shift) event.preventDefault();
  });

  // Save window bounds on move/resize (debounced)
  let boundsTimer: ReturnType<typeof setTimeout> | null = null;
  const saveBounds = (): void => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized())
        return;
      const b = mainWindow.getBounds();
      const global = (getSetting("global") as Record<string, unknown>) || {};
      global.windowBounds = {
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
      };
      setSetting("global", global);
    }, 500);
  };
  mainWindow.on("resize", saveBounds);
  mainWindow.on("move", saveBounds);

  // Also save immediately before close (debounce may not have flushed)
  mainWindow.on("close", () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    if (mainWindow && !mainWindow.isMinimized()) {
      const b = mainWindow.getBounds();
      const global = (getSetting("global") as Record<string, unknown>) || {};
      global.windowBounds = {
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
      };
      setSetting("global", global);
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    log.error("[renderer-gone]", details.reason, details.exitCode);
  });
  mainWindow.webContents.on("crashed", (_event, killed) => {
    log.error("[renderer-crashed] killed:", killed);
  });
  mainWindow.webContents.on("did-fail-load", (_event, code, desc) => {
    log.error("[did-fail-load]", code, desc);
  });
}

function buildMenu(): void {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
  ];
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(template as Electron.MenuItemConstructorOptions[]),
  );
}

function notifyRendererProjectsChanged(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("projects-changed");
  }
}

function sendStatus(text: string, type?: string): void {
  if (text) log.info(`[status] (${type || "info"}) ${text}`);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("status-update", text, type || "info");
  }
}

// --- fs.watch on projects directory ---
let projectsWatcher: fs.FSWatcher | null = null;

function startProjectsWatcher(): void {
  if (!fs.existsSync(PROJECTS_DIR)) return;

  const pendingFolders: Set<string> = new Set();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function flushChanges(): void {
    debounceTimer = null;
    const folders = new Set(pendingFolders);
    pendingFolders.clear();

    let changed = false;
    for (const folder of folders) {
      const folderPath = path.join(PROJECTS_DIR, folder);
      if (fs.existsSync(folderPath)) {
        detectSessionTransitions(folder, getMainWindow);
        refreshFolder(folder);
      } else {
        deleteCachedFolder(folder);
        deleteSearchFolder(folder);
      }
      changed = true;
    }

    if (changed) {
      notifyRendererProjectsChanged();
    }
  }

  try {
    projectsWatcher = fs.watch(
      PROJECTS_DIR,
      { recursive: true },
      (_eventType, filename) => {
        if (!filename) return;

        // filename is relative, e.g. "folder-name/sessions-index.json" or "folder-name/abc.jsonl"
        const parts = filename.split(path.sep);
        const folder = parts[0];
        if (!folder || folder === ".git") return;

        // Only care about .jsonl changes or top-level folder add/remove
        const basename = parts[parts.length - 1];
        if (parts.length === 1) {
          pendingFolders.add(folder);
        } else if (basename.endsWith(".jsonl")) {
          pendingFolders.add(folder);
        } else {
          return;
        }

        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(flushChanges, 500);
      },
    );

    projectsWatcher.on("error", (err: Error) => {
      log.error("[projects-watcher] error:", err.message);
    });
  } catch (e: unknown) {
    log.error("[projects-watcher] failed to start:", (e as Error).message);
  }
}

// --- Renderer logging bridge ---
ipcMain.on(
  "renderer-log",
  (_event: Electron.IpcMainEvent, level: string, msg: string) => {
    if (level === "error") log.error("[renderer]", msg);
    else log.warn("[renderer]", msg);
  },
);

// --- Register all IPC handlers ---
registerPtyHandlers(getMainWindow);
registerIpcHandlers(
  getMainWindow,
  autoUpdater,
  sendStatus,
  notifyRendererProjectsChanged,
);

// --- App lifecycle ---
void app.whenReady().then(() => {
  buildMenu();
  createWindow();
  startProjectsWatcher();

  // Warm up node-pty so first real spawn is fast
  setTimeout(() => warmupPty(sendStatus), 500);

  // Check for updates after launch
  if (autoUpdater) {
    setTimeout(
      () =>
        void autoUpdater
          .checkForUpdates()
          .catch((e: Error) =>
            log.error("[updater] check failed:", e?.message || String(e)),
          ),
      5000,
    );
    // Re-check every 4 hours for long-running sessions
    setInterval(
      () =>
        void autoUpdater
          .checkForUpdates()
          .catch((e: Error) =>
            log.error("[updater] check failed:", e?.message || String(e)),
          ),
      4 * 60 * 60 * 1000,
    );
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  // Close filesystem watcher
  if (projectsWatcher) {
    projectsWatcher.close();
    projectsWatcher = null;
  }

  // Kill all PTY processes on quit
  for (const [, session] of activeSessions) {
    if (!session.exited) {
      try {
        session.pty.kill();
      } catch (e: unknown) {
        log.debug("[before-quit] failed to kill PTY:", (e as Error).message);
      }
    }
  }
});
