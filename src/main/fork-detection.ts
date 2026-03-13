import fs from "node:fs";
import path from "node:path";
import type { BrowserWindow } from "electron";
import log from "electron-log";
import { PROJECTS_DIR } from "./constants";
import { activeSessions } from "./pty-manager";

/** Read first few lines of a new .jsonl to extract signals */
function readNewSessionSignals(filePath: string): {
  forkedFrom: string | null;
  planContent: boolean;
  slug: string | null;
  parentSessionId: string | null;
} {
  try {
    const buf = Buffer.alloc(8000);
    const fd = fs.openSync(filePath, "r");
    const bytesRead = fs.readSync(fd, buf, 0, 8000, 0);
    fs.closeSync(fd);
    const head = buf.toString("utf8", 0, bytesRead);
    const lines = head.split("\n").filter(Boolean);
    let forkedFrom: string | null = null;
    let planContent = false;
    let slug: string | null = null;
    let parentSessionId: string | null = null;
    for (const line of lines) {
      const entry = JSON.parse(line);
      if (entry.forkedFrom) forkedFrom = entry.forkedFrom.sessionId;
      if (entry.planContent) planContent = true;
      if (entry.slug && !slug) slug = entry.slug;
      // --fork-session copies messages with original sessionId
      if (entry.sessionId && !parentSessionId)
        parentSessionId = entry.sessionId;
      // Stop after finding a user or assistant message
      if (entry.type === "user" || entry.type === "assistant") break;
    }
    return { forkedFrom, planContent, slug, parentSessionId };
  } catch (e: unknown) {
    log.debug(
      `[readNewSessionSignals] failed for ${filePath}:`,
      (e as Error).message,
    );
    return {
      forkedFrom: null,
      planContent: false,
      slug: null,
      parentSessionId: null,
    };
  }
}

/** Read tail of old session file for ExitPlanMode and slug */
function readOldSessionTail(filePath: string): {
  hasExitPlanMode: boolean;
  slug: string | null;
} {
  try {
    const stat = fs.statSync(filePath);
    const size = stat.size;
    const readSize = Math.min(size, 8192);
    const buf = Buffer.alloc(readSize);
    const fd = fs.openSync(filePath, "r");
    fs.readSync(fd, buf, 0, readSize, size - readSize);
    fs.closeSync(fd);
    const tail = buf.toString("utf8");
    const hasExitPlanMode = tail.includes("ExitPlanMode");
    // Extract slug from tail (last occurrence)
    let slug: string | null = null;
    const slugMatches = tail.match(/"slug"\s*:\s*"([^"]+)"/g);
    if (slugMatches) {
      const last = slugMatches[slugMatches.length - 1].match(
        /"slug"\s*:\s*"([^"]+)"/,
      );
      if (last) slug = last[1];
    }
    return { hasExitPlanMode, slug };
  } catch (e: unknown) {
    log.debug(
      `[readOldSessionTail] failed for ${filePath}:`,
      (e as Error).message,
    );
    return { hasExitPlanMode: false, slug: null };
  }
}

/** Detect fork or plan-accept transitions for active PTY sessions in a folder */
export function detectSessionTransitions(
  folder: string,
  getMainWindow: () => BrowserWindow | null,
): void {
  const folderPath = path.join(PROJECTS_DIR, folder);
  let currentFiles: string[];
  try {
    currentFiles = fs
      .readdirSync(folderPath)
      .filter((f: string) => f.endsWith(".jsonl"));
  } catch {
    return;
  }

  for (const [sessionId, session] of [...activeSessions]) {
    if (
      session.exited ||
      session.isPlainTerminal ||
      !session.knownJsonlFiles ||
      session.projectFolder !== folder
    ) {
      if (!(session.exited || session.isPlainTerminal) && session.forkFrom) {
        log.info(
          `[fork-detect] skipped session=${sessionId} forkFrom=${session.forkFrom || "none"} reason=${session.exited ? "exited" : session.isPlainTerminal ? "terminal" : !session.knownJsonlFiles ? "noKnown" : `folderMismatch(${session.projectFolder} vs ${folder})`}`,
        );
      }
      continue;
    }

    const newFiles = currentFiles.filter(
      (f: string) => !session.knownJsonlFiles.has(f),
    );

    log.debug(
      `[detect] session=${sessionId} forkFrom=${session.forkFrom || "none"} folder=${folder} newFiles=${newFiles.length} knownCount=${session.knownJsonlFiles.size} currentCount=${currentFiles.length}`,
    );

    if (newFiles.length === 0) continue;

    const emptyFiles = new Set<string>(); // files with no signals yet (still being written)

    for (const newFile of newFiles) {
      const newFilePath = path.join(folderPath, newFile);
      const newId = path.basename(newFile, ".jsonl");
      const signals = readNewSessionSignals(newFilePath);

      // File exists but has no parseable content yet — skip and retry next cycle
      if (
        !(
          signals.forkedFrom ||
          signals.parentSessionId ||
          signals.slug ||
          signals.planContent
        )
      ) {
        emptyFiles.add(newFile);
        log.debug(
          `[detect] session=${sessionId} skipping empty newFile=${newId}`,
        );
        continue;
      }

      log.debug(
        `[detect] session=${sessionId} checking newFile=${newId} signals=${JSON.stringify({ forkedFrom: signals.forkedFrom || null, parentSessionId: signals.parentSessionId || null, slug: signals.slug || null })} forkFrom=${session.forkFrom || "none"}`,
      );

      let matched = false;

      // Fork: forkedFrom.sessionId matches this active PTY or the session it was forked from
      if (
        signals.forkedFrom === sessionId ||
        (session.forkFrom && signals.forkedFrom === session.forkFrom)
      ) {
        matched = true;
      }
      // --fork-session: new file's parentSessionId matches the forkFrom source,
      // and the new file's name (newId) differs from both our PTY id and the source
      if (
        !matched &&
        session.forkFrom &&
        signals.parentSessionId === session.forkFrom &&
        newId !== session.forkFrom
      ) {
        matched = true;
      }

      // Plan-accept: shared slug + planContent + old session has ExitPlanMode
      if (!matched && signals.planContent && signals.slug) {
        const oldFilePath = path.join(folderPath, `${sessionId}.jsonl`);
        const oldTail = readOldSessionTail(oldFilePath);
        if (oldTail.hasExitPlanMode && oldTail.slug === signals.slug) {
          // Temporal check: new file created within 30s of old file's last modification
          try {
            const oldMtime = fs.statSync(oldFilePath).mtimeMs;
            const newMtime = fs.statSync(newFilePath).mtimeMs;
            if (Math.abs(newMtime - oldMtime) < 30000) {
              matched = true;
            }
          } catch (e: unknown) {
            log.debug(
              `[detectSessionTransitions] stat failed for plan-accept check:`,
              (e as Error).message,
            );
          }
        }
      }

      if (matched) {
        log.info(
          `[session-transition] ${sessionId} → ${newId} (${signals.forkedFrom || session.forkFrom ? "fork" : "plan-accept"})`,
        );
        session.knownJsonlFiles = new Set(currentFiles);
        session.realSessionId = newId;
        // Update slug from new session
        if (signals.slug) session.sessionSlug = signals.slug;
        activeSessions.delete(sessionId);
        activeSessions.set(newId, session);
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("session-forked", sessionId, newId);
        }
        break; // Only one transition per session per flush
      }
    }

    // Update known files, but exclude empty ones so they get rechecked next cycle
    const updated = new Set(currentFiles);
    for (const f of emptyFiles) updated.delete(f);
    session.knownJsonlFiles = updated;
  }
}
