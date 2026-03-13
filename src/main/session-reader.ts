import fs from "node:fs";
import path from "node:path";

export interface SessionInfo {
  sessionId: string;
  folder: string;
  projectPath: string;
  summary: string;
  firstPrompt: string;
  created: string;
  modified: string;
  messageCount: number;
  textContent: string;
  slug: string | null;
  customTitle: string | null;
}

export interface FolderResult {
  folder: string;
  projectPath: string;
  sessions: SessionInfo[];
  mtimeMs: number;
}

/** Optional logger for error reporting — callers inject their own */
export interface SessionReaderLogger {
  debug: (msg: string) => void;
  warn: (msg: string) => void;
}

const noopLogger: SessionReaderLogger = {
  debug: () => {},
  warn: () => {},
};

/** Derive the real project path by reading cwd from the first JSONL entry in the folder */
export function deriveProjectPath(
  folderPath: string,
  logger: SessionReaderLogger = noopLogger,
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
        logger.debug(
          `[deriveProjectPath] failed to read subdirectory in ${folderPath}: ${(subErr as Error).message}`,
        );
      }
    }
  } catch (e: unknown) {
    logger.debug(
      `[deriveProjectPath] failed to read folder ${folderPath}: ${(e as Error).message}`,
    );
  }
  return null;
}

/** Parse a single .jsonl file into a session object (or null if invalid) */
export function readSessionFile(
  filePath: string,
  folder: string,
  projectPath: string,
  logger: SessionReaderLogger = noopLogger,
): SessionInfo | null {
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
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(line);
      } catch (lineErr: unknown) {
        logger.warn(
          `[readSessionFile] malformed JSONL line in session=${sessionId}: ${(lineErr as Error).message}`,
        );
        continue;
      }
      if (entry.slug && !slug) slug = entry.slug as string;
      if (entry.type === "custom-title" && entry.customTitle) {
        customTitle = entry.customTitle as string;
      }
      if (
        entry.type === "user" ||
        entry.type === "assistant" ||
        (entry.type === "message" &&
          (entry.role === "user" || entry.role === "assistant"))
      ) {
        messageCount++;
      }
      const msg = entry.message as
        | string
        | { content: string | { text: string }[] }
        | undefined;
      const text =
        typeof msg === "string"
          ? msg
          : typeof msg?.content === "string"
            ? msg.content
            : (
                (msg?.content as { text: string }[] | undefined)?.[0] as
                  | { text: string }
                  | undefined
              )?.text || "";
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
    logger.warn(
      `[readSessionFile] failed to parse session=${sessionId}: ${(e as Error).message}`,
    );
    return null;
  }
}

/** Read all sessions from a folder's .jsonl files */
export function readFolderSessions(
  folderPath: string,
  folder: string,
  projectPath: string,
  logger: SessionReaderLogger = noopLogger,
): SessionInfo[] {
  const sessions: SessionInfo[] = [];
  try {
    const jsonlFiles = fs
      .readdirSync(folderPath)
      .filter((f: string) => f.endsWith(".jsonl"));
    for (const file of jsonlFiles) {
      const s = readSessionFile(
        path.join(folderPath, file),
        folder,
        projectPath,
        logger,
      );
      if (s) sessions.push(s);
    }
  } catch (e: unknown) {
    logger.warn(
      `[readFolderSessions] failed to read folder=${folder}: ${(e as Error).message}`,
    );
  }
  return sessions;
}
