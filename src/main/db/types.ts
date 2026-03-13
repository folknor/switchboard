/** User-set metadata for a session (name, star, archive) */
export interface SessionMeta {
  sessionId: string;
  name: string | null;
  starred: number;
  archived: number;
}

/** Cached session data derived from .jsonl scanning */
export interface SessionCache {
  sessionId: string;
  folder: string;
  projectPath: string | null;
  summary: string | null;
  firstPrompt: string | null;
  created: string | null;
  modified: string | null;
  messageCount: number;
  slug: string | null;
}

/** Per-folder cache metadata (mtime tracking for incremental refresh) */
export interface FolderMeta {
  folder: string;
  projectPath: string | null;
  indexMtimeMs: number;
}

/** FTS search result */
export interface SearchResult {
  id: string;
  snippet: string;
}

/** Input for upserting a session into the cache */
export interface SessionInput {
  sessionId: string;
  folder: string;
  projectPath: string | null;
  summary: string | null;
  firstPrompt: string | null;
  created: string | null;
  modified: string | null;
  messageCount?: number;
  slug?: string | null;
}

/** Input for upserting a search index entry */
export interface SearchEntry {
  id: string;
  type: string;
  folder?: string | null;
  title?: string;
  body?: string;
}
