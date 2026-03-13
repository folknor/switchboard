import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import log from "electron-log";
import type { ProjectObj, SessionObj } from "../shared/types";
import { PROJECTS_DIR } from "./constants";
import {
  deleteCachedFolder,
  deleteCachedSession,
  deleteSearchFolder,
  deleteSearchSession,
  getAllCached,
  getAllFolderMeta,
  getAllMeta,
  getCachedByFolder,
  getSetting,
  setFolderMeta,
  setName,
  upsertCachedSessions,
  upsertSearchEntries,
} from "./db";
import {
  deriveProjectPath,
  readSessionFile,
  type SessionReaderLogger,
} from "./session-reader";

const readerLog: SessionReaderLogger = {
  debug: (msg: string): void => log.debug(msg),
  warn: (msg: string): void => log.warn(msg),
};

/** Convert folder name to a short display path */
export function folderToShortPath(folder: string): string {
  // Convert "-Users-home-dev-MyClaude" → "dev/MyClaude"
  const parts = folder.replace(/^-/, "").split("-");
  // Take last 2 meaningful segments
  const meaningful = parts.filter(Boolean);
  return meaningful.slice(-2).join("/");
}

/** Refresh a single folder incrementally: only re-read changed/new .jsonl files */
export function refreshFolder(folder: string): void {
  const folderPath = path.join(PROJECTS_DIR, folder);
  if (!fs.existsSync(folderPath)) {
    deleteCachedFolder(folder);
    return;
  }

  const projectPath = deriveProjectPath(folderPath, readerLog);
  if (!projectPath) {
    // Still record mtime so backgroundRefresh doesn't keep retrying
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(folderPath).mtimeMs;
    } catch (e: unknown) {
      log.debug(
        `[refreshFolder] stat failed for folder=${folder}:`,
        (e as Error).message,
      );
    }
    setFolderMeta(folder, null, mtimeMs);
    return;
  }

  // Get what's currently cached for this folder
  const cachedSessions = getCachedByFolder(folder);
  const cachedMap = new Map<string, string>(); // sessionId → modified ISO string
  for (const row of cachedSessions) {
    cachedMap.set(row.sessionId, row.modified);
  }

  // Scan current .jsonl files
  let jsonlFiles: string[];
  try {
    jsonlFiles = fs
      .readdirSync(folderPath)
      .filter((f: string) => f.endsWith(".jsonl"));
  } catch (e: unknown) {
    log.warn(
      `[refreshFolder] failed to list folder=${folder}:`,
      (e as Error).message,
    );
    return;
  }

  const currentIds = new Set<string>();

  for (const file of jsonlFiles) {
    const filePath = path.join(folderPath, file);
    const sessionId = path.basename(file, ".jsonl");
    currentIds.add(sessionId);

    // Check if file mtime changed
    let fileMtime: string;
    try {
      fileMtime = fs.statSync(filePath).mtime.toISOString();
    } catch (e: unknown) {
      log.debug(
        `[refreshFolder] stat failed for file=${file}:`,
        (e as Error).message,
      );
      continue;
    }

    if (cachedMap.has(sessionId) && cachedMap.get(sessionId) === fileMtime) {
      continue; // unchanged, skip
    }

    // File is new or modified — re-read it
    const s = readSessionFile(filePath, folder, projectPath, readerLog);
    if (s) {
      upsertCachedSessions([s]);
      deleteSearchSession(sessionId);
      upsertSearchEntries([
        {
          id: s.sessionId as string,
          type: "session",
          folder: s.folder as string,
          title: s.summary as string,
          body: s.textContent as string,
        },
      ]);
      if (s.customTitle)
        setName(s.sessionId as string, s.customTitle as string);
    }
  }

  // Remove sessions whose .jsonl files were deleted
  for (const sessionId of cachedMap.keys()) {
    if (!currentIds.has(sessionId)) {
      deleteCachedSession(sessionId);
      deleteSearchSession(sessionId);
    }
  }

  // Update folder mtime
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(folderPath).mtimeMs;
  } catch (e: unknown) {
    log.debug(
      `[refreshFolder] stat failed for folder=${folder}:`,
      (e as Error).message,
    );
  }
  setFolderMeta(folder, projectPath, mtimeMs);
}

/** Populate entire cache from filesystem (cold start) */
export function _populateCacheFromFilesystem(): void {
  try {
    const folders = fs
      .readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== ".git")
      .map((d) => d.name);

    for (const folder of folders) {
      refreshFolder(folder);
    }
  } catch (e: unknown) {
    log.error("[_populateCacheFromFilesystem] failed:", (e as Error).message);
  }
}

/** Build projects response from cached data */
export function buildProjectsFromCache(showArchived: boolean): ProjectObj[] {
  const metaMap = getAllMeta();
  const cachedRows = getAllCached();
  const global = (getSetting("global") as Record<string, unknown>) || {};
  const hiddenProjects = new Set((global.hiddenProjects as string[]) || []);

  // Group by projectPath (sessions from different Claude folders but same project merge)
  const projectMap = new Map<string, ProjectObj>();
  for (const row of cachedRows) {
    const pp = row.projectPath || row.folder;
    if (row.projectPath && hiddenProjects.has(row.projectPath)) continue;
    if (!projectMap.has(pp)) {
      projectMap.set(pp, {
        folder: row.folder,
        projectPath: row.projectPath,
        sessions: [],
      });
    }
    const meta = metaMap.get(row.sessionId);
    const s: SessionObj = {
      sessionId: row.sessionId,
      summary: row.summary || "",
      firstPrompt: row.firstPrompt || "",
      created: row.created || "",
      modified: row.modified || "",
      messageCount: row.messageCount,
      projectPath: row.projectPath,
      slug: row.slug || null,
      name: meta?.name || null,
      starred: meta?.starred || 0,
      archived: meta?.archived || 0,
    };
    if (!showArchived && s.archived) continue;
    (projectMap.get(pp) as ProjectObj).sessions.push(s);
  }

  // Include empty project directories (no sessions yet)
  try {
    const dirs = fs
      .readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== ".git");
    for (const d of dirs) {
      const projectPath = deriveProjectPath(
        path.join(PROJECTS_DIR, d.name),
        readerLog,
      );
      const key = projectPath || d.name;
      if (!projectMap.has(key)) {
        if (projectPath && !hiddenProjects.has(projectPath)) {
          projectMap.set(key, {
            folder: d.name,
            projectPath,
            sessions: [],
          });
        }
      }
    }
  } catch (e: unknown) {
    log.debug(
      "[buildProjectsFromCache] failed to list empty project dirs:",
      (e as Error).message,
    );
  }

  const projects: ProjectObj[] = [];
  for (const proj of projectMap.values()) {
    proj.sessions.sort(
      (a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime(),
    );
    projects.push(proj);
  }

  projects.sort((a, b) => {
    // Empty projects go to the bottom
    if (a.sessions.length === 0 && b.sessions.length > 0) return 1;
    if (b.sessions.length === 0 && a.sessions.length > 0) return -1;
    const aDate = a.sessions[0]?.modified || "";
    const bDate = b.sessions[0]?.modified || "";
    return new Date(bDate).getTime() - new Date(aDate).getTime();
  });

  return projects;
}

/** Background refresh: check mtimes, refresh stale folders */
export function backgroundRefresh(
  sendStatus: (text: string, type?: string) => void,
  notifyRendererProjectsChanged: () => void,
): void {
  try {
    const folders = fs
      .readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== ".git")
      .map((d) => d.name);

    const metaMap = getAllFolderMeta();
    const existingFolders = new Set(folders);
    let changed = false;

    // Check for new/changed folders
    for (const folder of folders) {
      const folderPath = path.join(PROJECTS_DIR, folder);
      let currentMtime = 0;
      try {
        currentMtime = fs.statSync(folderPath).mtimeMs;
      } catch (e: unknown) {
        log.debug(
          `[backgroundRefresh] stat failed for folder=${folder}:`,
          (e as Error).message,
        );
      }

      const cached = metaMap.get(folder);
      if (!cached || cached.indexMtimeMs !== currentMtime) {
        refreshFolder(folder);
        changed = true;
      }
    }

    // Check for removed folders
    for (const folder of metaMap.keys()) {
      if (!existingFolders.has(folder)) {
        deleteCachedFolder(folder);
        deleteSearchFolder(folder);
        changed = true;
      }
    }

    if (changed) {
      sendStatus("Refresh complete", "done");
      setTimeout(() => sendStatus(""), 3000);
      notifyRendererProjectsChanged();
    }
  } catch (e: unknown) {
    log.error("[backgroundRefresh] failed:", (e as Error).message);
  }
}

// --- Worker-based cache population (non-blocking) ---
let populatingCache = false;

export function isPopulatingCache(): boolean {
  return populatingCache;
}

export function populateCacheViaWorker(
  sendStatus: (text: string, type?: string) => void,
  notifyRendererProjectsChanged: () => void,
): void {
  if (populatingCache) return;
  populatingCache = true;
  sendStatus("Scanning projects\u2026", "active");

  const worker = new Worker(path.join(__dirname, "workers/scan-projects.js"), {
    workerData: { projectsDir: PROJECTS_DIR },
  });

  worker.on("message", (msg: Record<string, unknown>) => {
    // Progress updates from worker
    if (msg.type === "progress") {
      sendStatus(msg.text as string, "active");
      return;
    }

    if (!msg.ok) {
      sendStatus(`Scan failed: ${msg.error}`, "error");
      populatingCache = false;
      return;
    }

    const results = msg.results as Array<{
      folder: string;
      projectPath: string;
      sessions: Array<Record<string, unknown>>;
      mtimeMs: number;
    }>;

    sendStatus(`Indexing ${results.length} projects\u2026`, "active");

    // Write results to DB on main thread (fast)
    let sessionCount = 0;
    for (const { folder, projectPath, sessions, mtimeMs } of results) {
      deleteCachedFolder(folder);
      deleteSearchFolder(folder);
      if (sessions.length > 0) {
        sessionCount += sessions.length;
        upsertCachedSessions(sessions);
        upsertSearchEntries(
          sessions.map((s) => ({
            id: s.sessionId as string,
            type: "session",
            folder: s.folder as string,
            title: s.summary as string,
            body: s.textContent as string,
          })),
        );
        for (const s of sessions) {
          if (s.customTitle)
            setName(s.sessionId as string, s.customTitle as string);
        }
      }
      setFolderMeta(folder, projectPath, mtimeMs);
    }

    populatingCache = false;
    sendStatus(
      `Indexed ${sessionCount} sessions across ${results.length} projects`,
      "done",
    );
    // Clear status after a few seconds
    setTimeout(() => sendStatus(""), 5000);
    notifyRendererProjectsChanged();
  });

  worker.on("error", (err: Error) => {
    log.error("[worker-error]", err);
    sendStatus(`Worker error: ${err.message}`, "error");
    populatingCache = false;
  });
}
