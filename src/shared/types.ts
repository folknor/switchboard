/** A session as seen by the renderer (combines cache + meta) */
export interface SessionObj {
  sessionId: string;
  summary: string;
  firstPrompt: string;
  created: string;
  modified: string;
  messageCount: number;
  projectPath: string | null;
  slug: string | null;
  name: string | null;
  starred: number;
  archived: number;
  /** "terminal" for plain terminal sessions, undefined for claude sessions */
  type?: string;
}

/** A project grouping sessions by folder */
export interface ProjectObj {
  folder: string;
  projectPath: string | null;
  sessions: SessionObj[];
}

/** Plan file metadata */
export interface PlanInfo {
  filename: string;
  title: string;
  modified: string;
}

/** Memory file metadata */
export interface MemoryInfo {
  type: string;
  label: string;
  filename: string;
  filePath: string;
  modified: string;
}

/** Search result from FTS */
export interface SearchResult {
  id: string;
  snippet: string;
}
