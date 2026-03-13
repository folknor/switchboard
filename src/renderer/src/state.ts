import type { ITheme } from "@xterm/xterm";
import { getTerminalTheme } from "./themes";

// biome-ignore lint/suspicious/noExplicitAny: session objects from IPC have dynamic shape
export type SessionObj = Record<string, any>;
// biome-ignore lint/suspicious/noExplicitAny: project objects from IPC have dynamic shape
export type ProjectObj = Record<string, any>;

// --- DOM element references ---
export const statusBarInfo: HTMLElement | null =
  document.getElementById("status-bar-info");
export const statusBarActivity: HTMLElement | null = document.getElementById(
  "status-bar-activity",
);
export const terminalsEl: HTMLElement | null =
  document.getElementById("terminals");
export const sidebarContent: HTMLElement | null =
  document.getElementById("sidebar-content");
export const plansContent: HTMLElement | null =
  document.getElementById("plans-content");
export const placeholder: HTMLElement | null =
  document.getElementById("placeholder");
export const archiveToggle: HTMLElement | null =
  document.getElementById("archive-toggle");
export const starToggle: HTMLElement | null =
  document.getElementById("star-toggle");
export const searchInput: HTMLInputElement = document.getElementById(
  "search-input",
) as HTMLInputElement;
export const terminalHeader: HTMLElement | null =
  document.getElementById("terminal-header");
export const terminalHeaderName: HTMLElement | null = document.getElementById(
  "terminal-header-name",
);
export const terminalHeaderId: HTMLElement | null =
  document.getElementById("terminal-header-id");
export const terminalHeaderStatus: HTMLElement | null = document.getElementById(
  "terminal-header-status",
);
export const terminalStopBtn: HTMLElement | null =
  document.getElementById("terminal-stop-btn");
export const terminalRestartBtn: HTMLElement | null = document.getElementById(
  "terminal-restart-btn",
);
export const runningToggle: HTMLElement | null =
  document.getElementById("running-toggle");
export const todayToggle: HTMLElement | null =
  document.getElementById("today-toggle");
export const planViewer: HTMLElement | null =
  document.getElementById("plan-viewer");
export const planViewerTitle: HTMLElement | null =
  document.getElementById("plan-viewer-title");
export const planViewerFilepath: HTMLElement | null = document.getElementById(
  "plan-viewer-filepath",
);
export const planViewerEditorEl: HTMLElement | null =
  document.getElementById("plan-viewer-editor");
export const planCopyPathBtn: HTMLElement | null =
  document.getElementById("plan-copy-path-btn");
export const planCopyContentBtn: HTMLElement | null = document.getElementById(
  "plan-copy-content-btn",
);
export const planSaveBtn: HTMLElement | null =
  document.getElementById("plan-save-btn");
export const loadingStatus: HTMLElement | null =
  document.getElementById("loading-status");
export const sessionFilters: HTMLElement | null =
  document.getElementById("session-filters");
export const searchBar: HTMLElement | null =
  document.getElementById("search-bar");
export const statsContent: HTMLElement | null =
  document.getElementById("stats-content");
export const memoryContent: HTMLElement | null =
  document.getElementById("memory-content");
export const statsViewer: HTMLElement | null =
  document.getElementById("stats-viewer");
export const statsViewerBody: HTMLElement | null =
  document.getElementById("stats-viewer-body");
export const memoryViewer: HTMLElement | null =
  document.getElementById("memory-viewer");
export const memoryViewerTitle: HTMLElement | null = document.getElementById(
  "memory-viewer-title",
);
export const memoryViewerFilename: HTMLElement | null = document.getElementById(
  "memory-viewer-filename",
);
export const memoryViewerBody: HTMLElement | null =
  document.getElementById("memory-viewer-body");
export const terminalArea: HTMLElement | null =
  document.getElementById("terminal-area");
export const settingsViewer: HTMLElement | null =
  document.getElementById("settings-viewer");
export const settingsViewerTitle: HTMLElement | null = document.getElementById(
  "settings-viewer-title",
);
export const settingsViewerBody: HTMLElement | null = document.getElementById(
  "settings-viewer-body",
);
export const globalSettingsBtn: HTMLElement | null = document.getElementById(
  "global-settings-btn",
);
export const addProjectBtn: HTMLElement | null =
  document.getElementById("add-project-btn");
export const jsonlViewer: HTMLElement | null =
  document.getElementById("jsonl-viewer");
export const jsonlViewerTitle: HTMLElement | null =
  document.getElementById("jsonl-viewer-title");
export const jsonlViewerSessionId: HTMLElement | null = document.getElementById(
  "jsonl-viewer-session-id",
);
export const jsonlViewerBody: HTMLElement | null =
  document.getElementById("jsonl-viewer-body");
export const terminalHeaderPtyTitle: HTMLElement | null =
  document.getElementById("terminal-header-pty-title");
export const searchClear: HTMLElement | null =
  document.getElementById("search-clear");
export const statusBarUpdater: HTMLElement | null =
  document.getElementById("status-bar-updater");

// --- Plan editor state ---
export let currentPlanContent: string = "";
export let currentPlanFilePath: string = "";
export let _currentPlanFilename: string = "";

export function setCurrentPlanContent(v: string): void {
  currentPlanContent = v;
}
export function setCurrentPlanFilePath(v: string): void {
  currentPlanFilePath = v;
}
export function setCurrentPlanFilename(v: string): void {
  _currentPlanFilename = v;
}

// --- Session/project caches ---
// Map<sessionId, { terminal, element, fitAddon, session, closed }>
// biome-ignore lint/suspicious/noExplicitAny: dynamic session entry shape
export const openSessions: Map<string, any> = new Map();

export let activeSessionId: string | null =
  sessionStorage.getItem("activeSessionId") || null;
export function setActiveSession(id: string | null): void {
  activeSessionId = id;
  if (id) sessionStorage.setItem("activeSessionId", id);
  else sessionStorage.removeItem("activeSessionId");
}

export let showArchived: boolean = false;
export let showStarredOnly: boolean = false;
export let showRunningOnly: boolean = false;
export let showTodayOnly: boolean = false;

export function setShowArchived(v: boolean): void {
  showArchived = v;
}
export function setShowStarredOnly(v: boolean): void {
  showStarredOnly = v;
}
export function setShowRunningOnly(v: boolean): void {
  showRunningOnly = v;
}
export function setShowTodayOnly(v: boolean): void {
  showTodayOnly = v;
}

export let cachedProjects: ProjectObj[] = [];
export let cachedAllProjects: ProjectObj[] = [];
export let activePtyIds: Set<string> = new Set();
export let activeTab: string = "sessions";
export let cachedPlans: ProjectObj[] = [];
export let visibleSessionCount: number = 10;
export let sessionMaxAgeDays: number = 3;

export function setCachedProjects(v: ProjectObj[]): void {
  cachedProjects = v;
}
export function setCachedAllProjects(v: ProjectObj[]): void {
  cachedAllProjects = v;
}
export function setActivePtyIds(v: Set<string>): void {
  activePtyIds = v;
}
export function setActiveTab(v: string): void {
  activeTab = v;
}
export function setCachedPlans(v: ProjectObj[]): void {
  cachedPlans = v;
}
export function setVisibleSessionCount(v: number): void {
  visibleSessionCount = v;
}
export function setSessionMaxAgeDays(v: number): void {
  sessionMaxAgeDays = v;
}

// biome-ignore lint/suspicious/noExplicitAny: dynamic pending session shape
export const pendingSessions: Map<string, any> = new Map(); // sessionId → { session, projectPath, folder }

// Shared session map so all caches reference the same objects
export const sessionMap: Map<string, SessionObj> = new Map();

// --- Activity tracking ---
export const unreadSessions: Set<string> = new Set(); // sessions with unseen output
export const attentionSessions: Set<string> = new Set(); // sessions needing user action
export const lastActivityTime: Map<string, Date> = new Map(); // sessionId → Date of last terminal output

// --- Progress state ---
export const sessionProgressState: Map<
  string,
  { state: number; percent: number }
> = new Map();

// --- Theme ---
export let currentThemeName: string = "switchboard";
export let TERMINAL_THEME: ITheme = getTerminalTheme(currentThemeName);

export function setCurrentThemeName(name: string): void {
  currentThemeName = name;
  TERMINAL_THEME = getTerminalTheme(name);
}

// --- Memory cache ---
export let cachedMemories: ProjectObj[] = [];
export function setCachedMemories(v: ProjectObj[]): void {
  cachedMemories = v;
}

// --- Expand state persistence ---
export function getExpandedSlugs(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem("expandedSlugs") || "[]"));
  } catch {
    return new Set();
  }
}

export function saveExpandedSlugs(): void {
  const expanded: string[] = [];
  for (const g of document.querySelectorAll(".slug-group:not(.collapsed)")) {
    if (g.id) expanded.push(g.id);
  }
  sessionStorage.setItem("expandedSlugs", JSON.stringify(expanded));
}

// Noise patterns to ignore for unread tracking
export const unreadNoiseRe: RegExp = /file-history-snapshot|^\s*$/;
