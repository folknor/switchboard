/// <reference types="vite/client" />

interface Window {
  api: {
    getPlans(): Promise<Record<string, unknown>[]>;
    readPlan(filename: string): Promise<{ content: string; filePath: string }>;
    savePlan(
      filePath: string,
      content: string,
    ): Promise<{ ok: boolean; error?: string }>;
    getStats(): Promise<Record<string, unknown>>;
    getMemories(): Promise<Record<string, unknown>[]>;
    readMemory(filePath: string): Promise<string>;
    getProjects(showArchived: boolean): Promise<Record<string, unknown>[]>;
    getActiveSessions(): Promise<string[]>;
    getActiveTerminals(): Promise<{ sessionId: string; projectPath: string }[]>;
    stopSession(id: string): Promise<void>;
    toggleStar(id: string): Promise<{ starred: number }>;
    renameSession(id: string, name: string): Promise<void>;
    archiveSession(id: string, archived: boolean): Promise<void>;
    openTerminal(
      id: string,
      projectPath: string,
      isNew: boolean,
      sessionOptions?: Record<string, unknown>,
    ): Promise<void>;
    search(type: string, query: string): Promise<Record<string, unknown>[]>;
    readSessionJsonl(sessionId: string): Promise<Record<string, unknown>>;

    getSetting(key: string): Promise<unknown>;
    setSetting(key: string, value: unknown): Promise<void>;
    deleteSetting(key: string): Promise<void>;
    getEffectiveSettings(projectPath: string): Promise<Record<string, unknown>>;

    browseFolder(): Promise<string | null>;
    addProject(projectPath: string): Promise<void>;
    removeProject(projectPath: string): Promise<void>;
    openExternal(url: string): Promise<void>;

    logWarn(msg: string): void;
    logError(msg: string): void;

    sendInput(id: string, data: string): void;
    resizeTerminal(id: string, cols: number, rows: number): void;
    closeTerminal(id: string): void;

    onTerminalData(callback: (sessionId: string, data: string) => void): void;
    onSessionDetected(callback: (tempId: string, realId: string) => void): void;
    onProcessExited(
      callback: (sessionId: string, exitCode: number) => void,
    ): void;
    onProgressState(
      callback: (sessionId: string, state: number, percent: number) => void,
    ): void;
    onTerminalNotification(
      callback: (sessionId: string, message: string) => void,
    ): void;
    onSessionForked(callback: (oldId: string, newId: string) => void): void;
    onProjectsChanged(callback: () => void): void;
    onStatusUpdate(callback: (text: string, type: string) => void): void;
    onTerminalPassthrough(callback: (data: unknown) => void): void;

    updaterCheck(): Promise<unknown>;
    updaterDownload(): Promise<unknown>;
    updaterInstall(): Promise<unknown>;
    onUpdaterEvent(callback: (type: string, data: unknown) => void): void;
  };
}
