import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import log from "electron-log";
import { PROJECTS_DIR } from "./constants";
import {
  deleteCachedFolder,
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

/** Convert folder name to a short display path */
export function folderToShortPath(folder: string): string {
  // Convert "-Users-home-dev-MyClaude" → "dev/MyClaude"
  const parts = folder.replace(/^-/, "").split("-");
  // Take last 2 meaningful segments
  const meaningful = parts.filter(Boolean);
  return meaningful.slice(-2).join("/");
}

/** Derive the real project path by reading cwd from the first JSONL entry in the folder */
export function deriveProjectPath(
  folderPath: string,
  _folder: string,
): string | null {
  try {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    // Check direct .jsonl files first
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith(".jsonl")) {
        const firstLine = fs
          .readFileSync(path.join(folderPath, e.name), "utf8")
          .split("\n")[0];
        if (firstLine) {
          const parsed = JSON.parse(firstLine);
          if (parsed.cwd) return parsed.cwd as string;
        }
      }
    }
    // Check session subdirectories (UUID folders with subagent .jsonl files)
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const subDir = path.join(folderPath, e.name);
      try {
        // Look for .jsonl directly in session dir or in subagents/
        const subFiles = fs.readdirSync(subDir, { withFileTypes: true });
        for (const sf of subFiles) {
          let jsonlPath: string | undefined;
          if (sf.isFile() && sf.name.endsWith(".jsonl")) {
            jsonlPath = path.join(subDir, sf.name);
          } else if (sf.isDirectory() && sf.name === "subagents") {
            const agentFiles = fs
              .readdirSync(path.join(subDir, "subagents"))
              .filter((f: string) => f.endsWith(".jsonl"));
            if (agentFiles.length > 0)
              jsonlPath = path.join(subDir, "subagents", agentFiles[0]);
          }
          if (jsonlPath) {
            const firstLine = fs.readFileSync(jsonlPath, "utf8").split("\n")[0];
            if (firstLine) {
              const parsed = JSON.parse(firstLine);
              if (parsed.cwd) return parsed.cwd as string;
            }
          }
        }
      } catch (subErr: unknown) {
        log.debug(
          `[deriveProjectPath] failed to read subdirectory in ${folderPath}:`,
          (subErr as Error).message,
        );
      }
    }
  } catch (e: unknown) {
    log.debug(
      `[deriveProjectPath] failed to read folder ${folderPath}:`,
      (e as Error).message,
    );
  }
  // No cwd found — return null so callers can skip this folder
  return null;
}

/** Parse a single .jsonl file into a session object (or null if invalid) */
export function readSessionFile(
  filePath: string,
  folder: string,
  projectPath: string,
): Record<string, unknown> | null {
  const sessionId = path.basename(filePath, ".jsonl");
  try {
    const stat = fs.statSync(filePath);
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n").filter(Boolean);
    let summary = "";
    let messageCount = 0;
    let textContent = "";
    let slug: string | null = null;
    let customTitle: string | null = null;
    for (const line of lines) {
      const entry = JSON.parse(line);
      if (entry.slug && !slug) slug = entry.slug;
      if (entry.type === "custom-title" && entry.customTitle) {
        customTitle = entry.customTitle;
      }
      if (
        entry.type === "user" ||
        entry.type === "assistant" ||
        (entry.type === "message" &&
          (entry.role === "user" || entry.role === "assistant"))
      ) {
        messageCount++;
      }
      const msg = entry.message;
      const text =
        typeof msg === "string"
          ? msg
          : typeof msg?.content === "string"
            ? msg.content
            : msg?.content?.[0]?.text || "";
      if (
        !summary &&
        (entry.type === "user" ||
          (entry.type === "message" && entry.role === "user"))
      ) {
        if (text) summary = text.slice(0, 120);
      }
      if (text && textContent.length < 8000) {
        textContent += `${text.slice(0, 500)}\n`;
      }
    }
    if (!summary || messageCount < 1) return null;
    return {
      sessionId,
      folder,
      projectPath,
      summary,
      firstPrompt: summary,
      created: stat.birthtime.toISOString(),
      modified: stat.mtime.toISOString(),
      messageCount,
      textContent,
      slug,
      customTitle,
    };
  } catch (e: unknown) {
    log.warn(
      `[readSessionFile] failed to parse session=${sessionId}:`,
      (e as Error).message,
    );
    return null;
  }
}

/** Read one folder from filesystem by scanning .jsonl files directly */
export function _readFolderFromFilesystem(folder: string): {
  projectPath: string | null;
  sessions: Record<string, unknown>[];
} {
  const folderPath = path.join(PROJECTS_DIR, folder);
  const projectPath = deriveProjectPath(folderPath, folder);
  if (!projectPath) return { projectPath: null, sessions: [] };
  const sessions: Record<string, unknown>[] = [];

  try {
    const jsonlFiles = fs
      .readdirSync(folderPath)
      .filter((f: string) => f.endsWith(".jsonl"));
    for (const file of jsonlFiles) {
      const s = readSessionFile(
        path.join(folderPath, file),
        folder,
        projectPath,
      );
      if (s) sessions.push(s);
    }
  } catch (e: unknown) {
    log.warn(
      `[_readFolderFromFilesystem] failed to read folder=${folder}:`,
      (e as Error).message,
    );
  }

  return { projectPath, sessions };
}

/** Refresh a single folder incrementally: only re-read changed/new .jsonl files */
export function refreshFolder(folder: string): void {
  const folderPath = path.join(PROJECTS_DIR, folder);
  if (!fs.existsSync(folderPath)) {
    deleteCachedFolder(folder);
    return;
  }

  const projectPath = deriveProjectPath(folderPath, folder);
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
  let _changed = false;

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
    const s = readSessionFile(filePath, folder, projectPath);
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
    _changed = true;
  }

  // Remove sessions whose .jsonl files were deleted
  for (const sessionId of cachedMap.keys()) {
    if (!currentIds.has(sessionId)) {
      deleteCachedFolder(sessionId);
      deleteSearchSession(sessionId);
      _changed = true;
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
export function buildProjectsFromCache(
  showArchived: boolean,
): Record<string, unknown>[] {
  const metaMap = getAllMeta();
  const cachedRows = getAllCached();
  const global = (getSetting("global") as Record<string, unknown>) || {};
  const hiddenProjects = new Set((global.hiddenProjects as string[]) || []);

  // Group by folder
  const folderMap = new Map<
    string,
    {
      folder: string;
      projectPath: string | null;
      sessions: Record<string, unknown>[];
    }
  >();
  for (const row of cachedRows) {
    if (hiddenProjects.has(row.projectPath as string)) continue;
    if (!folderMap.has(row.folder)) {
      folderMap.set(row.folder, {
        folder: row.folder,
        projectPath: row.projectPath,
        sessions: [],
      });
    }
    const meta = metaMap.get(row.sessionId);
    const s: Record<string, unknown> = {
      sessionId: row.sessionId,
      summary: row.summary,
      firstPrompt: row.firstPrompt,
      created: row.created,
      modified: row.modified,
      messageCount: row.messageCount,
      projectPath: row.projectPath,
      slug: row.slug || null,
      name: meta?.name || null,
      starred: meta?.starred || 0,
      archived: meta?.archived || 0,
    };
    if (!showArchived && s.archived) continue;
    (
      folderMap.get(row.folder) as { sessions: Record<string, unknown>[] }
    ).sessions.push(s);
  }

  // Include empty project directories (no sessions yet)
  try {
    const dirs = fs
      .readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== ".git");
    for (const d of dirs) {
      if (!folderMap.has(d.name)) {
        const projectPath = deriveProjectPath(
          path.join(PROJECTS_DIR, d.name),
          d.name,
        );
        if (projectPath && !hiddenProjects.has(projectPath)) {
          folderMap.set(d.name, {
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

  const projects: Record<string, unknown>[] = [];
  for (const proj of folderMap.values()) {
    proj.sessions.sort(
      (a: Record<string, unknown>, b: Record<string, unknown>) =>
        new Date(b.modified as string).getTime() -
        new Date(a.modified as string).getTime(),
    );
    projects.push(proj);
  }

  projects.sort((a, b) => {
    const aSessions = a.sessions as Record<string, unknown>[];
    const bSessions = b.sessions as Record<string, unknown>[];
    // Empty projects go to the bottom
    if (aSessions.length === 0 && bSessions.length > 0) return 1;
    if (bSessions.length === 0 && aSessions.length > 0) return -1;
    const aDate = (aSessions[0]?.modified as string) || "";
    const bDate = (bSessions[0]?.modified as string) || "";
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
