import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { BrowserWindow } from "electron";
import { dialog, shell as electronShell, ipcMain } from "electron";
import log from "electron-log";
import type { AppUpdater } from "electron-updater";
import {
  CLAUDE_DIR,
  PLANS_DIR,
  PROJECTS_DIR,
  STATS_CACHE_PATH,
} from "./constants";
import {
  deleteCachedFolder,
  deleteSearchFolder,
  deleteSearchType,
  deleteSetting,
  getCachedFolder,
  getSetting,
  isCachePopulated,
  isSearchIndexPopulated,
  searchByType,
  setArchived,
  setName,
  setSetting,
  toggleStar,
  upsertSearchEntries,
} from "./db";
import {
  backgroundRefresh,
  buildProjectsFromCache,
  folderToShortPath,
  isPopulatingCache,
  populateCacheViaWorker,
  refreshFolder,
} from "./session-scanner";

const SETTING_DEFAULTS: Record<string, unknown> = {
  permissionMode: null,
  dangerouslySkipPermissions: false,
  worktree: false,
  worktreeName: "",
  chrome: false,
  preLaunchCmd: "",
  addDirs: "",
  visibleSessionCount: 5,
  sidebarWidth: 340,
  terminalTheme: "switchboard",
};

export function registerIpcHandlers(
  getMainWindow: () => BrowserWindow | null,
  autoUpdater: AppUpdater | null,
  sendStatus: (text: string, type?: string) => void,
  notifyRendererProjectsChanged: () => void,
): void {
  // --- IPC: browse-folder ---
  ipcMain.handle("browse-folder", async (): Promise<string | null> => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory", "createDirectory"],
      title: "Select Project Folder",
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  // --- IPC: add-project ---
  ipcMain.handle(
    "add-project",
    (
      _event: Electron.IpcMainInvokeEvent,
      projectPath: string,
    ): {
      ok?: boolean;
      folder?: string;
      projectPath?: string;
      error?: string;
    } => {
      try {
        // Validate the path exists and is a directory
        const stat = fs.statSync(projectPath);
        if (!stat.isDirectory()) return { error: "Path is not a directory" };

        // Unhide if previously hidden
        const global = (getSetting("global") as Record<string, unknown>) || {};
        if (
          (global.hiddenProjects as string[] | undefined)?.includes(projectPath)
        ) {
          global.hiddenProjects = (global.hiddenProjects as string[]).filter(
            (p: string) => p !== projectPath,
          );
          setSetting("global", global);
        }

        // Create the corresponding folder in ~/.claude/projects/ so it persists
        const folder = projectPath.replace(/[/_]/g, "-").replace(/^-/, "-");
        const folderPath = path.join(PROJECTS_DIR, folder);
        if (!fs.existsSync(folderPath)) {
          fs.mkdirSync(folderPath, { recursive: true });
        }

        // Seed a minimal .jsonl so deriveProjectPath can read the cwd
        if (
          !fs.readdirSync(folderPath).some((f: string) => f.endsWith(".jsonl"))
        ) {
          const seedId = randomUUID();
          const seedFile = path.join(folderPath, `${seedId}.jsonl`);
          const now = new Date().toISOString();
          const line = JSON.stringify({
            type: "user",
            cwd: projectPath,
            sessionId: seedId,
            uuid: randomUUID(),
            timestamp: now,
            message: { role: "user", content: "New project" },
          });
          fs.writeFileSync(seedFile, `${line}\n`);
        }

        // Immediately index the new folder so it's in cache before frontend renders
        refreshFolder(folder);
        notifyRendererProjectsChanged();

        return { ok: true, folder, projectPath };
      } catch (err: unknown) {
        return { error: (err as Error).message };
      }
    },
  );

  // --- IPC: remove-project ---
  ipcMain.handle(
    "remove-project",
    (
      _event: Electron.IpcMainInvokeEvent,
      projectPath: string,
    ): { ok?: boolean; error?: string } => {
      try {
        // Add to hidden projects list
        const global = (getSetting("global") as Record<string, unknown>) || {};
        const hidden = (global.hiddenProjects as string[]) || [];
        if (!hidden.includes(projectPath)) hidden.push(projectPath);
        global.hiddenProjects = hidden;
        setSetting("global", global);

        // Clean up DB cache and search index for this folder
        const folder = projectPath.replace(/[/_]/g, "-").replace(/^-/, "-");
        deleteCachedFolder(folder);
        deleteSearchFolder(folder);
        deleteSetting(`project:${projectPath}`);

        notifyRendererProjectsChanged();
        return { ok: true };
      } catch (err: unknown) {
        return { error: (err as Error).message };
      }
    },
  );

  // --- IPC: open-external ---
  ipcMain.handle(
    "open-external",
    (
      _event: Electron.IpcMainInvokeEvent,
      url: string,
    ): Promise<void> | undefined => {
      if (/^https?:\/\//i.test(url)) return electronShell.openExternal(url);
    },
  );

  // --- IPC: get-projects ---
  ipcMain.handle(
    "get-projects",
    (
      _event: Electron.IpcMainInvokeEvent,
      showArchived: boolean,
    ): Record<string, unknown>[] => {
      try {
        const needsPopulate = !(isCachePopulated() && isSearchIndexPopulated());

        if (needsPopulate) {
          populateCacheViaWorker(sendStatus, notifyRendererProjectsChanged);
          return [];
        }

        const projects = buildProjectsFromCache(showArchived);

        // Non-blocking background refresh
        if (!isPopulatingCache()) {
          setImmediate(() =>
            backgroundRefresh(sendStatus, notifyRendererProjectsChanged),
          );
        }

        return projects;
      } catch (e: unknown) {
        log.error("[get-projects] failed:", (e as Error).message);
        return [];
      }
    },
  );

  // --- IPC: get-plans ---
  ipcMain.handle(
    "get-plans",
    (): { filename: string; title: string; modified: string }[] => {
      try {
        if (!fs.existsSync(PLANS_DIR)) return [];
        const files = fs
          .readdirSync(PLANS_DIR)
          .filter((f: string) => f.endsWith(".md"));
        const plans: { filename: string; title: string; modified: string }[] =
          [];
        for (const file of files) {
          const filePath = path.join(PLANS_DIR, file);
          try {
            const stat = fs.statSync(filePath);
            const content = fs.readFileSync(filePath, "utf8");
            const firstLine = content.split("\n").find((l: string) => l.trim());
            const title = firstLine?.startsWith("# ")
              ? firstLine.slice(2).trim()
              : file.replace(/\.md$/, "");
            plans.push({
              filename: file,
              title,
              modified: stat.mtime.toISOString(),
            });
          } catch (e: unknown) {
            log.warn(
              `[get-plans] failed to read plan file=${file}:`,
              (e as Error).message,
            );
          }
        }
        plans.sort(
          (a, b) =>
            new Date(b.modified).getTime() - new Date(a.modified).getTime(),
        );

        // Index plans for FTS
        try {
          deleteSearchType("plan");
          upsertSearchEntries(
            plans.map((p) => ({
              id: p.filename,
              type: "plan",
              folder: null,
              title: p.title,
              body: fs.readFileSync(path.join(PLANS_DIR, p.filename), "utf8"),
            })),
          );
        } catch (e: unknown) {
          log.warn("[get-plans] FTS indexing failed:", (e as Error).message);
        }

        return plans;
      } catch (e: unknown) {
        log.error("[get-plans] failed:", (e as Error).message);
        return [];
      }
    },
  );

  // --- IPC: read-plan ---
  ipcMain.handle(
    "read-plan",
    (
      _event: Electron.IpcMainInvokeEvent,
      filename: string,
    ): { content: string; filePath: string } => {
      try {
        const filePath = path.join(PLANS_DIR, path.basename(filename));
        const content = fs.readFileSync(filePath, "utf8");
        return { content, filePath };
      } catch (e: unknown) {
        log.warn(
          `[read-plan] failed for file=${filename}:`,
          (e as Error).message,
        );
        return { content: "", filePath: "" };
      }
    },
  );

  // --- IPC: save-plan ---
  ipcMain.handle(
    "save-plan",
    (
      _event: Electron.IpcMainInvokeEvent,
      filePath: string,
      content: string,
    ): { ok: boolean; error?: string } => {
      try {
        const resolved = path.resolve(filePath);
        if (!resolved.startsWith(PLANS_DIR)) {
          return { ok: false, error: "path outside plans directory" };
        }
        fs.writeFileSync(resolved, content, "utf8");
        return { ok: true };
      } catch (err: unknown) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  // --- IPC: get-stats ---
  ipcMain.handle("get-stats", (): unknown => {
    try {
      if (!fs.existsSync(STATS_CACHE_PATH)) return null;
      const raw = fs.readFileSync(STATS_CACHE_PATH, "utf8");
      return JSON.parse(raw);
    } catch (e: unknown) {
      log.warn("[get-stats] failed:", (e as Error).message);
      return null;
    }
  });

  // --- IPC: get-memories ---
  ipcMain.handle(
    "get-memories",
    (): {
      type: string;
      label: string;
      filename: string;
      filePath: string;
      modified: string;
    }[] => {
      const memories: {
        type: string;
        label: string;
        filename: string;
        filePath: string;
        modified: string;
      }[] = [];
      try {
        // Global CLAUDE.md
        const globalClaude = path.join(CLAUDE_DIR, "CLAUDE.md");
        if (fs.existsSync(globalClaude)) {
          const content = fs.readFileSync(globalClaude, "utf8").trim();
          if (content) {
            const stat = fs.statSync(globalClaude);
            memories.push({
              type: "global",
              label: "Global",
              filename: "CLAUDE.md",
              filePath: globalClaude,
              modified: stat.mtime.toISOString(),
            });
          }
        }

        // Per-project CLAUDE.md and memory/MEMORY.md
        if (fs.existsSync(PROJECTS_DIR)) {
          const folders = fs
            .readdirSync(PROJECTS_DIR, { withFileTypes: true })
            .filter((d) => d.isDirectory() && d.name !== ".git")
            .map((d) => d.name);

          for (const folder of folders) {
            const shortPath = folderToShortPath(folder);
            const folderPath = path.join(PROJECTS_DIR, folder);

            // CLAUDE.md in project folder
            const claudeMd = path.join(folderPath, "CLAUDE.md");
            if (fs.existsSync(claudeMd)) {
              const content = fs.readFileSync(claudeMd, "utf8").trim();
              if (content) {
                const stat = fs.statSync(claudeMd);
                memories.push({
                  type: "project",
                  label: shortPath,
                  filename: "CLAUDE.md",
                  filePath: claudeMd,
                  modified: stat.mtime.toISOString(),
                });
              }
            }

            // memory/MEMORY.md in project folder
            const memoryMd = path.join(folderPath, "memory", "MEMORY.md");
            if (fs.existsSync(memoryMd)) {
              const content = fs.readFileSync(memoryMd, "utf8").trim();
              if (content) {
                const stat = fs.statSync(memoryMd);
                memories.push({
                  type: "auto",
                  label: shortPath,
                  filename: "MEMORY.md",
                  filePath: memoryMd,
                  modified: stat.mtime.toISOString(),
                });
              }
            }
          }
        }
      } catch (e: unknown) {
        log.error(
          "[get-memories] failed to enumerate memories:",
          (e as Error).message,
        );
      }

      // Index memories for FTS
      try {
        deleteSearchType("memory");
        upsertSearchEntries(
          memories.map((m) => ({
            id: m.filePath,
            type: "memory",
            folder: null,
            title: `${m.label} ${m.filename}`,
            body: fs.readFileSync(m.filePath, "utf8"),
          })),
        );
      } catch (e: unknown) {
        log.warn("[get-memories] FTS indexing failed:", (e as Error).message);
      }

      return memories;
    },
  );

  // --- IPC: read-memory ---
  ipcMain.handle(
    "read-memory",
    (_event: Electron.IpcMainInvokeEvent, filePath: string): string => {
      try {
        // Validate path is under ~/.claude/
        const resolved = path.resolve(filePath);
        if (!resolved.startsWith(CLAUDE_DIR)) {
          return "";
        }
        return fs.readFileSync(resolved, "utf8");
      } catch (e: unknown) {
        log.warn(
          `[read-memory] failed for path=${filePath}:`,
          (e as Error).message,
        );
        return "";
      }
    },
  );

  // --- IPC: search ---
  ipcMain.handle(
    "search",
    (
      _event: Electron.IpcMainInvokeEvent,
      type: string,
      query: string,
    ): { id: string; snippet: string }[] => searchByType(type, query, 50),
  );

  // --- IPC: read-session-jsonl ---
  ipcMain.handle(
    "read-session-jsonl",
    (
      _event: Electron.IpcMainInvokeEvent,
      sessionId: string,
    ): { entries?: unknown[]; error?: string } => {
      const folder = getCachedFolder(sessionId);
      if (!folder) return { error: "Session not found in cache" };
      const jsonlPath = path.join(PROJECTS_DIR, folder, `${sessionId}.jsonl`);
      try {
        const content = fs.readFileSync(jsonlPath, "utf-8");
        const entries: unknown[] = [];
        for (const line of content.split("\n")) {
          if (!line.trim()) continue;
          try {
            entries.push(JSON.parse(line));
          } catch (e: unknown) {
            log.warn(
              `[read-session-jsonl] malformed line in session=${sessionId}:`,
              (e as Error).message,
            );
          }
        }
        return { entries };
      } catch (err: unknown) {
        return { error: (err as Error).message };
      }
    },
  );

  // --- IPC: toggle-star ---
  ipcMain.handle(
    "toggle-star",
    (
      _event: Electron.IpcMainInvokeEvent,
      sessionId: string,
    ): { starred: number } => {
      const starred = toggleStar(sessionId);
      return { starred };
    },
  );

  // --- IPC: rename-session ---
  ipcMain.handle(
    "rename-session",
    (
      _event: Electron.IpcMainInvokeEvent,
      sessionId: string,
      name: string,
    ): { name: string | null } => {
      setName(sessionId, name || null);
      return { name: name || null };
    },
  );

  // --- IPC: archive-session ---
  ipcMain.handle(
    "archive-session",
    (
      _event: Electron.IpcMainInvokeEvent,
      sessionId: string,
      archived: boolean,
    ): { archived: number } => {
      setArchived(sessionId, archived);
      return { archived: archived ? 1 : 0 };
    },
  );

  // --- IPC: settings ---
  ipcMain.handle(
    "get-setting",
    (_event: Electron.IpcMainInvokeEvent, key: string): unknown =>
      getSetting(key),
  );

  ipcMain.handle(
    "set-setting",
    (
      _event: Electron.IpcMainInvokeEvent,
      key: string,
      value: unknown,
    ): { ok: boolean } => {
      setSetting(key, value);
      return { ok: true };
    },
  );

  ipcMain.handle(
    "delete-setting",
    (_event: Electron.IpcMainInvokeEvent, key: string): { ok: boolean } => {
      deleteSetting(key);
      return { ok: true };
    },
  );

  ipcMain.handle(
    "get-effective-settings",
    (
      _event: Electron.IpcMainInvokeEvent,
      projectPath: string,
    ): Record<string, unknown> => {
      const global = (getSetting("global") as Record<string, unknown>) || {};
      const project = projectPath
        ? (getSetting(`project:${projectPath}`) as Record<string, unknown>) ||
          {}
        : {};
      const effective: Record<string, unknown> = { ...SETTING_DEFAULTS };
      for (const key of Object.keys(SETTING_DEFAULTS)) {
        if (global[key] !== undefined && global[key] !== null) {
          effective[key] = global[key];
        }
        if (project[key] !== undefined && project[key] !== null) {
          effective[key] = project[key];
        }
      }
      return effective;
    },
  );

  // --- IPC: auto-updater ---
  ipcMain.handle(
    "updater-check",
    (): { available: boolean; dev: boolean } | Promise<unknown> | undefined => {
      if (!autoUpdater) return { available: false, dev: true };
      return autoUpdater.checkForUpdates();
    },
  );

  ipcMain.handle("updater-download", (): Promise<unknown> | undefined => {
    if (!autoUpdater) return;
    return autoUpdater.downloadUpdate();
  });

  ipcMain.handle("updater-install", (): void => {
    if (!autoUpdater) return;
    autoUpdater.quitAndInstall();
  });
}
