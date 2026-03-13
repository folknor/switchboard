/// <reference types="vite/client" />

interface Window {
  api: {
    getPlans(): Promise<any[]>;
    readPlan(filename: string): Promise<{ content: string; filePath: string }>;
    savePlan(
      filePath: string,
      content: string,
    ): Promise<{ ok: boolean; error?: string }>;
    getStats(): Promise<any>;
    getMemories(): Promise<any[]>;
    readMemory(filePath: string): Promise<string>;
    getProjects(showArchived: boolean): Promise<any[]>;
    getActiveSessions(): Promise<string[]>;
    getActiveTerminals(): Promise<{ sessionId: string; projectPath: string }[]>;
    stopSession(id: string): Promise<any>;
    toggleStar(id: string): Promise<{ starred: number }>;
    renameSession(id: string, name: string): Promise<any>;
    archiveSession(id: string, archived: boolean): Promise<any>;
    openTerminal(
      id: string,
      projectPath: string,
      isNew: boolean,
      sessionOptions?: any,
    ): Promise<any>;
    search(type: string, query: string): Promise<any[]>;
    readSessionJsonl(sessionId: string): Promise<any>;

    getSetting(key: string): Promise<any>;
    setSetting(key: string, value: any): Promise<any>;
    deleteSetting(key: string): Promise<any>;
    getEffectiveSettings(projectPath: string): Promise<any>;

    browseFolder(): Promise<string | null>;
    addProject(projectPath: string): Promise<any>;
    removeProject(projectPath: string): Promise<any>;
    openExternal(url: string): Promise<void>;

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
    onTerminalPassthrough(callback: (data: any) => void): void;

    updaterCheck(): Promise<any>;
    updaterDownload(): Promise<any>;
    updaterInstall(): Promise<any>;
    onUpdaterEvent(callback: (type: string, data: any) => void): void;
  };
}
