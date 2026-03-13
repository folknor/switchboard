import process from "node:process";
import type { BrowserWindow } from "electron";
import { app } from "electron";
import log from "electron-log";
import type { AppUpdater } from "electron-updater";
import { autoUpdater as _autoUpdater } from "electron-updater";

export function setupAutoUpdater(
  getMainWindow: () => BrowserWindow | null,
): AppUpdater | null {
  if (!(app.isPackaged || process.env.FORCE_UPDATER)) return null;

  const updater: AppUpdater = _autoUpdater;
  updater.logger = log;
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  if (!app.isPackaged) updater.forceDevUpdateConfig = true;

  function sendUpdaterEvent(type: string, data?: unknown): void {
    log.info(`[updater] ${type}`, data || "");
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send("updater-event", type, data);
    }
  }

  updater.on("checking-for-update", () => sendUpdaterEvent("checking"));
  updater.on("update-available", (info) =>
    sendUpdaterEvent("update-available", info),
  );
  updater.on("update-not-available", (info) =>
    sendUpdaterEvent("update-not-available", info),
  );
  updater.on("download-progress", (progress) =>
    sendUpdaterEvent("download-progress", progress),
  );
  updater.on("update-downloaded", (info) =>
    sendUpdaterEvent("update-downloaded", info),
  );
  updater.on("error", (err) => {
    log.error("[updater] Error:", err?.message || String(err));
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send("updater-event", "error", {
        message: err?.message || String(err),
      });
    }
  });

  return updater;
}
