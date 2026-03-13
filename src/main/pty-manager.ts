import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import type { BrowserWindow } from "electron";
import { ipcMain } from "electron";
import log from "electron-log";
import type { IPty } from "node-pty";
import pty from "node-pty";
import { cleanPtyEnv, MAX_BUFFER_SIZE, PROJECTS_DIR } from "./constants";

/** Escape a string for safe inclusion in a single-quoted shell argument */
function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export interface PtySession {
  pty: IPty;
  rendererAttached: boolean;
  exited: boolean;
  outputBuffer: string[];
  outputBufferSize: number;
  altScreen: boolean;
  projectPath: string;
  firstResize: boolean;
  projectFolder: string | null;
  knownJsonlFiles: Set<string>;
  sessionSlug: string | null;
  isPlainTerminal: boolean;
  forkFrom: string | null;
  realSessionId?: string;
  _suppressBuffer?: boolean;
}

// Active PTY sessions
export const activeSessions: Map<string, PtySession> = new Map();

export function warmupPty(
  sendStatus: (text: string, type?: string) => void,
): void {
  sendStatus("Warming up terminal\u2026", "active");
  try {
    const userShell = process.env.SHELL || "/bin/zsh";
    const p = pty.spawn(userShell, ["-l", "-i", "-c", "claude"], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: os.homedir(),
      env: {
        ...cleanPtyEnv,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        TERM_PROGRAM: "iTerm.app",
        FORCE_COLOR: "3",
        ITERM_SESSION_ID: "1",
      },
    });
    p.onExit(() => {
      sendStatus("Terminal ready", "done");
      setTimeout(() => sendStatus(""), 3000);
    });
    setTimeout(() => {
      try {
        p.kill();
      } catch (e: unknown) {
        log.debug("[warmupPty] kill failed:", (e as Error).message);
      }
    }, 5000);
  } catch (e: unknown) {
    log.warn("[warmupPty] spawn failed:", (e as Error).message);
    sendStatus("");
  }
}

export function registerPtyHandlers(
  getMainWindow: () => BrowserWindow | null,
): void {
  // --- IPC: get-active-sessions ---
  ipcMain.handle("get-active-sessions", (): string[] => {
    const active: string[] = [];
    for (const [sessionId, session] of activeSessions) {
      if (!session.exited) active.push(sessionId);
    }
    return active;
  });

  // --- IPC: get-active-terminals --- (plain terminal sessions for renderer restore)
  ipcMain.handle(
    "get-active-terminals",
    (): { sessionId: string; projectPath: string }[] => {
      const terminals: { sessionId: string; projectPath: string }[] = [];
      for (const [sessionId, session] of activeSessions) {
        if (!session.exited && session.isPlainTerminal) {
          terminals.push({ sessionId, projectPath: session.projectPath });
        }
      }
      return terminals;
    },
  );

  // --- IPC: stop-session ---
  ipcMain.handle(
    "stop-session",
    (
      _event: Electron.IpcMainInvokeEvent,
      sessionId: string,
    ): { ok: boolean; error?: string } => {
      const session = activeSessions.get(sessionId);
      if (!session || session.exited)
        return { ok: false, error: "not running" };
      session.pty.kill();
      return { ok: true };
    },
  );

  // --- IPC: open-terminal ---
  ipcMain.handle(
    "open-terminal",
    // biome-ignore lint/complexity/useMaxParams: IPC handler receives individual args from renderer
    (
      _event: Electron.IpcMainInvokeEvent,
      sessionId: string,
      projectPath: string,
      isNew: boolean,
      sessionOptions: Record<string, unknown> | undefined,
    ): { ok: boolean; reattached?: boolean; error?: string } => {
      const mainWindow = getMainWindow();
      if (!mainWindow) return { ok: false, error: "no window" };

      // Reattach to existing session
      if (activeSessions.has(sessionId)) {
        const session = activeSessions.get(sessionId) as PtySession;
        session.rendererAttached = true;
        session.firstResize = !session.isPlainTerminal;

        // If TUI is in alternate screen mode, send escape to switch into it
        if (session.altScreen && !session.isPlainTerminal) {
          mainWindow.webContents.send(
            "terminal-data",
            sessionId,
            "\x1b[?1049h",
          );
        }

        // Send buffered output for reattach
        for (const chunk of session.outputBuffer) {
          mainWindow.webContents.send("terminal-data", sessionId, chunk);
        }

        if (!session.isPlainTerminal) {
          // Hide cursor after buffer replay — the live PTY stream or resize nudge
          // will re-show it at the correct position, avoiding a stale cursor artifact
          mainWindow.webContents.send("terminal-data", sessionId, "\x1b[?25l");
        }

        return { ok: true, reattached: true };
      }

      // Spawn new PTY
      if (!fs.existsSync(projectPath)) {
        return {
          ok: false,
          error: `project directory no longer exists: ${projectPath}`,
        };
      }

      const shell = process.env.SHELL || "/bin/zsh";
      const isPlainTerminal = sessionOptions?.type === "terminal";

      let knownJsonlFiles: Set<string> = new Set();
      let sessionSlug: string | null = null;
      let projectFolder: string | null = null;

      if (!isPlainTerminal) {
        // Snapshot existing .jsonl files before spawning (for new session + fork/plan detection)
        projectFolder = projectPath.replace(/[/_]/g, "-").replace(/^-/, "-");
        const claudeProjectDir = path.join(PROJECTS_DIR, projectFolder);
        if (fs.existsSync(claudeProjectDir)) {
          try {
            knownJsonlFiles = new Set(
              fs
                .readdirSync(claudeProjectDir)
                .filter((f: string) => f.endsWith(".jsonl")),
            );
          } catch (e: unknown) {
            log.debug(
              `[open-terminal] failed to snapshot jsonl files for session=${sessionId}:`,
              (e as Error).message,
            );
          }
        }

        // Read slug from the session's jsonl file (for plan-accept detection)
        if (!isNew) {
          try {
            const jsonlPath = path.join(claudeProjectDir, `${sessionId}.jsonl`);
            const head = fs.readFileSync(jsonlPath, "utf8").slice(0, 8000);
            const firstLines = head.split("\n").filter(Boolean);
            for (const line of firstLines) {
              const entry = JSON.parse(line);
              if (entry.slug) {
                sessionSlug = entry.slug;
                break;
              }
            }
          } catch (e: unknown) {
            log.debug(
              `[open-terminal] failed to read slug for session=${sessionId}:`,
              (e as Error).message,
            );
          }
        }
      }

      let ptyProcess: IPty;
      try {
        if (isPlainTerminal) {
          // Plain terminal: interactive login shell, no claude command
          // Inject a shell function to override `claude` with a helpful message
          const claudeShim =
            'claude() { echo "\\033[33mTo start a Claude session, use the + button in the sidebar.\\033[0m"; return 1; }; export -f claude 2>/dev/null;';
          ptyProcess = pty.spawn(shell, ["-l", "-i"], {
            name: "xterm-256color",
            cols: 120,
            rows: 30,
            cwd: projectPath,
            env: {
              ...cleanPtyEnv,
              TERM: "xterm-256color",
              COLORTERM: "truecolor",
              TERM_PROGRAM: "iTerm.app",
              FORCE_COLOR: "3",
              ITERM_SESSION_ID: "1",
              CLAUDECODE: "1",
              // ZDOTDIR trick won't work reliably; instead inject via ENV (sh/bash) or precmd
              ENV: claudeShim,
              BASH_ENV: claudeShim,
            },
          });
          // For zsh, ENV/BASH_ENV don't apply — write the function after shell starts
          setTimeout(() => {
            if (!(ptyProcess as IPty & { _isDisposed?: boolean })._isDisposed) {
              try {
                ptyProcess.write(`${claudeShim} clear\n`);
              } catch (e: unknown) {
                log.debug(
                  "[open-terminal] failed to inject claude shim:",
                  (e as Error).message,
                );
              }
            }
          }, 300);
        } else {
          // Build claude command with session options
          let claudeCmd: string;
          if (sessionOptions?.forkFrom) {
            claudeCmd = `claude --resume "${sessionOptions.forkFrom}" --fork-session`;
          } else if (isNew) {
            claudeCmd = `claude --session-id "${sessionId}"`;
          } else {
            claudeCmd = `claude --resume "${sessionId}"`;
          }

          if (sessionOptions) {
            if (sessionOptions.dangerouslySkipPermissions) {
              claudeCmd += " --dangerously-skip-permissions";
            } else if (sessionOptions.permissionMode) {
              claudeCmd += ` --permission-mode ${shellEscape(String(sessionOptions.permissionMode))}`;
            }
            if (sessionOptions.worktree) {
              claudeCmd += " --worktree";
              if (sessionOptions.worktreeName) {
                claudeCmd += ` ${shellEscape(String(sessionOptions.worktreeName))}`;
              }
            }
            if (sessionOptions.chrome) {
              claudeCmd += " --chrome";
            }
            if (sessionOptions.addDirs) {
              const dirs = (sessionOptions.addDirs as string)
                .split(",")
                .map((d: string) => d.trim())
                .filter(Boolean);
              for (const dir of dirs) {
                claudeCmd += ` --add-dir ${shellEscape(dir)}`;
              }
            }
          }

          if (sessionOptions?.preLaunchCmd) {
            // preLaunchCmd is intentionally not escaped — it's a user-provided
            // shell command (e.g. "env FOO=bar") that must be evaluated by the shell
            claudeCmd = `${String(sessionOptions.preLaunchCmd)} ${claudeCmd}`;
          }

          ptyProcess = pty.spawn(shell, ["-l", "-i", "-c", claudeCmd], {
            name: "xterm-256color",
            cols: 120,
            rows: 30,
            cwd: projectPath,
            // TERM_PROGRAM=iTerm.app: Claude Code checks this to decide whether to emit
            // OSC 9 notifications (e.g. "needs your attention"). Without it, the packaged
            // app's minimal Electron environment won't trigger those sequences.
            env: {
              ...cleanPtyEnv,
              TERM: "xterm-256color",
              COLORTERM: "truecolor",
              TERM_PROGRAM: "iTerm.app",
              FORCE_COLOR: "3",
              ITERM_SESSION_ID: "1",
            },
          });
        }
      } catch (err: unknown) {
        return {
          ok: false,
          error: `Error spawning PTY: ${(err as Error).message}`,
        };
      }

      const session: PtySession = {
        pty: ptyProcess,
        rendererAttached: true,
        exited: false,
        outputBuffer: [],
        outputBufferSize: 0,
        altScreen: false,
        projectPath,
        firstResize: true,
        projectFolder,
        knownJsonlFiles,
        sessionSlug,
        isPlainTerminal,
        forkFrom: (sessionOptions?.forkFrom as string) || null,
      };
      activeSessions.set(sessionId, session);

      ptyProcess.onData((data: string) => {
        const currentId = session.realSessionId || sessionId;
        const win = getMainWindow();

        // Log all OSC sequences (title changes, bells, etc.)
        if (data.includes("\x1b]")) {
          const oscMatches = data.matchAll(
            // biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape sequence parsing
            /\x1b\](\d+);([^\x07\x1b]*)(?:\x07|\x1b\\)/g,
          );
          for (const m of oscMatches) {
            const code = m[1];
            const payload = m[2].slice(0, 120);
            // Skip notification (9) — already logged below
            if (code !== "9")
              log.debug(
                `[OSC ${code}] session=${currentId} payload="${payload}"`,
              );
          }
          // Parse iTerm2 OSC 9 notification (terminated by BEL \x07 or ST \x1b\\)
          const notifMatch = data.match(
            // biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape sequence parsing
            /\x1b\]9;([^\x07\x1b]*)(?:\x07|\x1b\\)/,
          );
          if (notifMatch && !notifMatch[1].startsWith("4;")) {
            const message = notifMatch[1];
            log.debug(`[OSC 9] session=${currentId} message="${message}"`);
            if (win && !win.isDestroyed()) {
              win.webContents.send("terminal-notification", currentId, message);
            }
          }

          // Parse iTerm2 OSC 9;4 progress sequences
          const progressMatch = data.match(
            // biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape sequence parsing
            /\x1b\]9;4;(\d)(?:;(\d+))?(?:\x07|\x1b\\)/,
          );
          if (progressMatch) {
            const state = parseInt(progressMatch[1], 10);
            const percent = progressMatch[2]
              ? parseInt(progressMatch[2], 10)
              : -1;
            log.debug(
              `[OSC 9;4] session=${currentId} state=${state} percent=${percent}`,
            );
            if (win && !win.isDestroyed()) {
              win.webContents.send("progress-state", currentId, state, percent);
            }
          }
        }

        // Standalone BEL (not part of an OSC sequence)
        if (data.includes("\x07") && !data.includes("\x1b]")) {
          log.info(`[BEL] session=${currentId}`);
        }

        // Track alternate screen mode (only if data contains the marker)
        if (data.includes("\x1b[?")) {
          if (data.includes("\x1b[?1049h") || data.includes("\x1b[?47h")) {
            session.altScreen = true;
            log.info(`[altscreen] session=${currentId} ON`);
          }
          if (data.includes("\x1b[?1049l") || data.includes("\x1b[?47l")) {
            session.altScreen = false;
            log.info(`[altscreen] session=${currentId} OFF`);
          }
        }

        // Buffer output (skip resize-triggered redraws for plain terminals)
        if (!session._suppressBuffer) {
          session.outputBuffer.push(data);
          session.outputBufferSize += data.length;
          while (
            session.outputBufferSize > MAX_BUFFER_SIZE &&
            session.outputBuffer.length > 1
          ) {
            session.outputBufferSize -= (
              session.outputBuffer.shift() as string
            ).length;
          }
        }

        if (win && !win.isDestroyed()) {
          win.webContents.send("terminal-data", currentId, data);
        }
      });

      ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
        session.exited = true;
        const realId = session.realSessionId || sessionId;
        const win = getMainWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send("process-exited", realId, exitCode);
        }
        activeSessions.delete(realId);
      });

      if (sessionOptions?.forkFrom) {
        log.info(
          `[fork-spawn] tempId=${sessionId} forkFrom=${sessionOptions.forkFrom} folder=${projectFolder} knownFiles=${knownJsonlFiles.size}`,
        );
      }

      return { ok: true, reattached: false };
    },
  );

  // --- IPC: terminal-input (fire-and-forget) ---
  ipcMain.on(
    "terminal-input",
    (_event: Electron.IpcMainEvent, sessionId: string, data: string) => {
      const session = activeSessions.get(sessionId);
      if (session && !session.exited) {
        session.pty.write(data);
      }
    },
  );

  // --- IPC: terminal-resize (fire-and-forget) ---
  ipcMain.on(
    "terminal-resize",
    (
      _event: Electron.IpcMainEvent,
      sessionId: string,
      cols: number,
      rows: number,
    ) => {
      const session = activeSessions.get(sessionId);
      if (session && !session.exited) {
        // For plain terminals, suppress buffering during resize to avoid
        // accumulating prompt redraws that pollute reattach replay
        if (session.isPlainTerminal) session._suppressBuffer = true;

        session.pty.resize(cols, rows);

        if (session.isPlainTerminal) {
          setTimeout(() => {
            session._suppressBuffer = false;
          }, 200);
        }

        // First resize: nudge to force TUI redraw on reattach (skip for plain terminals — causes duplicate prompts)
        if (session.firstResize && !session.isPlainTerminal) {
          session.firstResize = false;
          setTimeout(() => {
            try {
              session.pty.resize(cols + 1, rows);
              setTimeout(() => {
                try {
                  session.pty.resize(cols, rows);
                } catch (e: unknown) {
                  log.debug(
                    "[terminal-resize] nudge restore failed:",
                    (e as Error).message,
                  );
                }
              }, 50);
            } catch (e: unknown) {
              log.debug(
                "[terminal-resize] nudge failed:",
                (e as Error).message,
              );
            }
          }, 50);
        }
      }
    },
  );

  // --- IPC: close-terminal ---
  ipcMain.on(
    "close-terminal",
    (_event: Electron.IpcMainEvent, sessionId: string) => {
      const session = activeSessions.get(sessionId);
      if (session) {
        session.rendererAttached = false;
        if (session.exited) {
          activeSessions.delete(sessionId);
        }
      }
    },
  );
}
