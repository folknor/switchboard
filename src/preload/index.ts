import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("api", {
  // Invoke (request-response)
  getPlans: () => ipcRenderer.invoke("get-plans"),
  readPlan: (filename: string) => ipcRenderer.invoke("read-plan", filename),
  savePlan: (filePath: string, content: string) =>
    ipcRenderer.invoke("save-plan", filePath, content),
  getStats: () => ipcRenderer.invoke("get-stats"),
  getMemories: () => ipcRenderer.invoke("get-memories"),
  readMemory: (filePath: string) => ipcRenderer.invoke("read-memory", filePath),
  getProjects: (showArchived: boolean) =>
    ipcRenderer.invoke("get-projects", showArchived),
  getActiveSessions: () => ipcRenderer.invoke("get-active-sessions"),
  getActiveTerminals: () => ipcRenderer.invoke("get-active-terminals"),
  stopSession: (id: string) => ipcRenderer.invoke("stop-session", id),
  toggleStar: (id: string) => ipcRenderer.invoke("toggle-star", id),
  renameSession: (id: string, name: string) =>
    ipcRenderer.invoke("rename-session", id, name),
  archiveSession: (id: string, archived: boolean) =>
    ipcRenderer.invoke("archive-session", id, archived),
  openTerminal: (
    id: string,
    projectPath: string,
    isNew: boolean,
    sessionOptions?: Record<string, unknown>,
  ) =>
    ipcRenderer.invoke("open-terminal", id, projectPath, isNew, sessionOptions),
  search: (type: string, query: string) =>
    ipcRenderer.invoke("search", type, query),
  readSessionJsonl: (sessionId: string) =>
    ipcRenderer.invoke("read-session-jsonl", sessionId),

  // Settings
  getSetting: (key: string) => ipcRenderer.invoke("get-setting", key),
  setSetting: (key: string, value: unknown) =>
    ipcRenderer.invoke("set-setting", key, value),
  deleteSetting: (key: string) => ipcRenderer.invoke("delete-setting", key),
  getEffectiveSettings: (projectPath: string) =>
    ipcRenderer.invoke("get-effective-settings", projectPath),

  browseFolder: () => ipcRenderer.invoke("browse-folder"),
  addProject: (projectPath: string) =>
    ipcRenderer.invoke("add-project", projectPath),
  removeProject: (projectPath: string) =>
    ipcRenderer.invoke("remove-project", projectPath),
  openExternal: (url: string) => ipcRenderer.invoke("open-external", url),

  // Logging (renderer → main process electron-log)
  logWarn: (msg: string) => ipcRenderer.send("renderer-log", "warn", msg),
  logError: (msg: string) => ipcRenderer.send("renderer-log", "error", msg),

  // Send (fire-and-forget)
  sendInput: (id: string, data: string) =>
    ipcRenderer.send("terminal-input", id, data),
  resizeTerminal: (id: string, cols: number, rows: number) =>
    ipcRenderer.send("terminal-resize", id, cols, rows),
  closeTerminal: (id: string) => ipcRenderer.send("close-terminal", id),

  // Listeners (main → renderer)
  onTerminalData: (callback: (sessionId: string, data: string) => void) => {
    ipcRenderer.on("terminal-data", (_event, sessionId, data) =>
      callback(sessionId, data),
    );
  },
  onProcessExited: (
    callback: (sessionId: string, exitCode: number) => void,
  ) => {
    ipcRenderer.on("process-exited", (_event, sessionId, exitCode) =>
      callback(sessionId, exitCode),
    );
  },
  onProgressState: (
    callback: (sessionId: string, state: number, percent: number) => void,
  ) => {
    ipcRenderer.on("progress-state", (_event, sessionId, state, percent) =>
      callback(sessionId, state, percent),
    );
  },
  onTerminalNotification: (
    callback: (sessionId: string, message: string) => void,
  ) => {
    ipcRenderer.on("terminal-notification", (_event, sessionId, message) =>
      callback(sessionId, message),
    );
  },
  onSessionForked: (callback: (oldId: string, newId: string) => void) => {
    ipcRenderer.on("session-forked", (_event, oldId, newId) =>
      callback(oldId, newId),
    );
  },
  onProjectsChanged: (callback: () => void) => {
    ipcRenderer.on("projects-changed", () => callback());
  },
  onStatusUpdate: (callback: (text: string, type: string) => void) => {
    ipcRenderer.on("status-update", (_event, text, type) =>
      callback(text, type),
    );
  },
  onTerminalPassthrough: (callback: (data: unknown) => void) => {
    ipcRenderer.on("terminal-passthrough", (_event, data) => callback(data));
  },

  // Auto-updater
  updaterCheck: () => ipcRenderer.invoke("updater-check"),
  updaterDownload: () => ipcRenderer.invoke("updater-download"),
  updaterInstall: () => ipcRenderer.invoke("updater-install"),
  onUpdaterEvent: (callback: (type: string, data: unknown) => void) => {
    ipcRenderer.on("updater-event", (_event, type, data) =>
      callback(type, data),
    );
  },
});
