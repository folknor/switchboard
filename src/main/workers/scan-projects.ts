import fs from "node:fs";
import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import {
  deriveProjectPath,
  type FolderResult,
  readFolderSessions,
  type SessionReaderLogger,
} from "../session-reader";

const PROJECTS_DIR: string = workerData.projectsDir;

const workerLog: SessionReaderLogger = {
  debug: (_msg: string): void => {},
  warn: (msg: string): void => {
    parentPort?.postMessage({ type: "progress", text: `Warning: ${msg}` });
  },
};

function readFolderFromFilesystem(folder: string): FolderResult | null {
  const folderPath = path.join(PROJECTS_DIR, folder);
  const projectPath = deriveProjectPath(folderPath, workerLog);
  if (!projectPath) return null;

  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(folderPath).mtimeMs;
  } catch {
    // stat failure — use default 0
  }

  const sessions = readFolderSessions(
    folderPath,
    folder,
    projectPath,
    workerLog,
  );

  return { folder, projectPath, sessions, mtimeMs };
}

// Scan all folders
try {
  const folders = fs
    .readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== ".git")
    .map((d) => d.name);

  const results: FolderResult[] = [];
  for (let i = 0; i < folders.length; i++) {
    if (i % 5 === 0 || i === folders.length - 1) {
      parentPort?.postMessage({
        type: "progress",
        text: `Scanning projects (${i + 1}/${folders.length})\u2026`,
      });
    }
    const result = readFolderFromFilesystem(folders[i]);
    if (result) results.push(result);
  }
  parentPort?.postMessage({ ok: true, results });
} catch (err: unknown) {
  parentPort?.postMessage({ ok: false, error: (err as Error).message });
}
