import os from "node:os";
import path from "node:path";
import process from "node:process";

export const PROJECTS_DIR: string = path.join(
  os.homedir(),
  ".claude",
  "projects",
);
export const PLANS_DIR: string = path.join(os.homedir(), ".claude", "plans");
export const CLAUDE_DIR: string = path.join(os.homedir(), ".claude");
export const STATS_CACHE_PATH: string = path.join(
  CLAUDE_DIR,
  "stats-cache.json",
);
export const MAX_BUFFER_SIZE: number = 256 * 1024;

// Clean env for child processes — strip Electron internals that cause nested
// Electron apps (or node-pty inside them) to malfunction.
export const cleanPtyEnv: Record<string, string | undefined> =
  Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) =>
        !(k.startsWith("ELECTRON_") || k.startsWith("GOOGLE_API_KEY")) &&
        k !== "NODE_OPTIONS" &&
        k !== "ORIGINAL_XDG_CURRENT_DESKTOP",
    ),
  );
