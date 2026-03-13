import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import log from "electron-log";
import { runMigrations } from "./schema";
import type {
  FolderMeta,
  SearchEntry,
  SearchResult,
  SessionCache,
  SessionInput,
  SessionMeta,
} from "./types";

// --- Connection setup ---

const DATA_DIR: string = path.join(os.homedir(), ".switchboard");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH: string = path.join(DATA_DIR, "switchboard.db");

// Migrate from old locations if needed
const OLD_LOCATIONS: string[] = [
  path.join(os.homedir(), ".claude", "browser", "switchboard.db"),
  path.join(os.homedir(), ".claude", "browser", "session-browser.db"),
  path.join(os.homedir(), ".claude", "session-browser.db"),
];
if (!fs.existsSync(DB_PATH)) {
  for (const oldPath of OLD_LOCATIONS) {
    if (fs.existsSync(oldPath)) {
      fs.renameSync(oldPath, DB_PATH);
      try {
        fs.renameSync(`${oldPath}-wal`, `${DB_PATH}-wal`);
      } catch {
        // WAL file may not exist for this db — non-fatal
      }
      try {
        fs.renameSync(`${oldPath}-shm`, `${DB_PATH}-shm`);
      } catch {
        // SHM file may not exist for this db — non-fatal
      }
      break;
    }
  }
}

const db: Database.Database = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
runMigrations(db);

// --- Prepared statements ---

// biome-ignore lint/nursery/useExplicitType: complex inferred type from prepared statements
const stmts = {
  // Session meta
  get: db.prepare<[string], SessionMeta>(
    "SELECT * FROM session_meta WHERE sessionId = ?",
  ),
  getAll: db.prepare<[], SessionMeta>("SELECT * FROM session_meta"),
  upsertName: db.prepare<[string, string | null]>(`
    INSERT INTO session_meta (sessionId, name) VALUES (?, ?)
    ON CONFLICT(sessionId) DO UPDATE SET name = excluded.name
  `),
  upsertStar: db.prepare<[string]>(`
    INSERT INTO session_meta (sessionId, starred) VALUES (?, 1)
    ON CONFLICT(sessionId) DO UPDATE SET starred = CASE WHEN starred = 1 THEN 0 ELSE 1 END
  `),
  upsertArchived: db.prepare<[string, number]>(`
    INSERT INTO session_meta (sessionId, archived) VALUES (?, ?)
    ON CONFLICT(sessionId) DO UPDATE SET archived = excluded.archived
  `),

  // Session cache
  cacheCount: db.prepare<[], { cnt: number }>(
    "SELECT COUNT(*) as cnt FROM session_cache",
  ),
  cacheGetAll: db.prepare<[], SessionCache>("SELECT * FROM session_cache"),
  cacheUpsert: db.prepare<
    [
      string,
      string,
      string | null,
      string | null,
      string | null,
      string | null,
      string | null,
      number,
      string | null,
    ]
  >(`
    INSERT INTO session_cache (sessionId, folder, projectPath, summary, firstPrompt, created, modified, messageCount, slug)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(sessionId) DO UPDATE SET
      folder = excluded.folder, projectPath = excluded.projectPath,
      summary = excluded.summary, firstPrompt = excluded.firstPrompt,
      created = excluded.created, modified = excluded.modified,
      messageCount = excluded.messageCount, slug = excluded.slug
  `),
  cacheGetByFolder: db.prepare<
    [string],
    { sessionId: string; modified: string }
  >("SELECT sessionId, modified FROM session_cache WHERE folder = ?"),
  cacheGetFolder: db.prepare<[string], { folder: string }>(
    "SELECT folder FROM session_cache WHERE sessionId = ?",
  ),
  cacheDeleteSession: db.prepare<[string]>(
    "DELETE FROM session_cache WHERE sessionId = ?",
  ),
  cacheDeleteFolder: db.prepare<[string]>(
    "DELETE FROM session_cache WHERE folder = ?",
  ),

  // Folder meta
  metaGet: db.prepare<[string], FolderMeta>(
    "SELECT * FROM cache_meta WHERE folder = ?",
  ),
  metaGetAll: db.prepare<[], FolderMeta>("SELECT * FROM cache_meta"),
  metaUpsert: db.prepare<[string, string | null, number]>(`
    INSERT INTO cache_meta (folder, projectPath, indexMtimeMs)
    VALUES (?, ?, ?)
    ON CONFLICT(folder) DO UPDATE SET
      projectPath = excluded.projectPath, indexMtimeMs = excluded.indexMtimeMs
  `),
  metaDelete: db.prepare<[string]>("DELETE FROM cache_meta WHERE folder = ?"),

  // FTS search
  searchDeleteBySession: db.prepare<[string]>(
    "DELETE FROM search_fts WHERE rowid IN (SELECT rowid FROM search_map WHERE type = 'session' AND id = ?)",
  ),
  searchMapDeleteBySession: db.prepare<[string]>(
    "DELETE FROM search_map WHERE type = 'session' AND id = ?",
  ),
  searchDeleteByFolder: db.prepare<[string]>(
    "DELETE FROM search_fts WHERE rowid IN (SELECT rowid FROM search_map WHERE type = 'session' AND folder = ?)",
  ),
  searchMapDeleteByFolder: db.prepare<[string]>(
    "DELETE FROM search_map WHERE type = 'session' AND folder = ?",
  ),
  searchDeleteByType: db.prepare<[string]>(
    "DELETE FROM search_fts WHERE rowid IN (SELECT rowid FROM search_map WHERE type = ?)",
  ),
  searchMapDeleteByType: db.prepare<[string]>(
    "DELETE FROM search_map WHERE type = ?",
  ),
  searchInsertFts: db.prepare<[number | bigint, string, string]>(
    "INSERT OR REPLACE INTO search_fts(rowid, title, body) VALUES (?, ?, ?)",
  ),
  searchInsertMap: db.prepare<[string, string, string | null]>(
    "INSERT OR REPLACE INTO search_map(id, type, folder) VALUES (?, ?, ?)",
  ),
  searchQuery: db.prepare<[string, string, number], SearchResult>(`
    SELECT search_map.id, snippet(search_fts, 1, '<mark>', '</mark>', '...', 40) as snippet
    FROM search_fts
    JOIN search_map ON search_fts.rowid = search_map.rowid
    WHERE search_map.type = ? AND search_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `),

  // Settings
  settingsGet: db.prepare<[string], { value: string }>(
    "SELECT value FROM settings WHERE key = ?",
  ),
  settingsUpsert: db.prepare<[string, string]>(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `),
  settingsDelete: db.prepare<[string]>("DELETE FROM settings WHERE key = ?"),
};

// --- Session meta queries ---

export function getMeta(sessionId: string): SessionMeta | null {
  return stmts.get.get(sessionId) || null;
}

export function getAllMeta(): Map<string, SessionMeta> {
  const rows = stmts.getAll.all();
  const map = new Map<string, SessionMeta>();
  for (const row of rows) map.set(row.sessionId, row);
  return map;
}

export function setName(sessionId: string, name: string | null): void {
  stmts.upsertName.run(sessionId, name);
}

export function toggleStar(sessionId: string): number {
  stmts.upsertStar.run(sessionId);
  const row = stmts.get.get(sessionId);
  if (!row) return 0;
  return row.starred;
}

export function setArchived(sessionId: string, archived: boolean): void {
  stmts.upsertArchived.run(sessionId, archived ? 1 : 0);
}

// --- Session cache queries ---

export function isCachePopulated(): boolean {
  const row = stmts.cacheCount.get();
  return row ? row.cnt > 0 : false;
}

export function getAllCached(): SessionCache[] {
  return stmts.cacheGetAll.all();
}

// biome-ignore lint/nursery/useExplicitType: inferred from db.transaction
const upsertCachedSessionsBatch = db.transaction((sessions: SessionInput[]) => {
  for (const s of sessions) {
    stmts.cacheUpsert.run(
      s.sessionId,
      s.folder,
      s.projectPath,
      s.summary,
      s.firstPrompt,
      s.created,
      s.modified,
      s.messageCount || 0,
      s.slug || null,
    );
  }
});

export function upsertCachedSessions(sessions: SessionInput[]): void {
  upsertCachedSessionsBatch(sessions);
}

export function getCachedByFolder(
  folder: string,
): { sessionId: string; modified: string }[] {
  return stmts.cacheGetByFolder.all(folder);
}

export function getCachedFolder(sessionId: string): string | null {
  const row = stmts.cacheGetFolder.get(sessionId);
  return row ? row.folder : null;
}

export function deleteCachedSession(sessionId: string): void {
  stmts.cacheDeleteSession.run(sessionId);
}

export function deleteCachedFolder(folder: string): void {
  stmts.cacheDeleteFolder.run(folder);
  stmts.metaDelete.run(folder);
}

// --- Folder meta queries ---

export function getFolderMeta(folder: string): FolderMeta | null {
  return stmts.metaGet.get(folder) || null;
}

export function getAllFolderMeta(): Map<string, FolderMeta> {
  const rows = stmts.metaGetAll.all();
  const map = new Map<string, FolderMeta>();
  for (const row of rows) map.set(row.folder, row);
  return map;
}

export function setFolderMeta(
  folder: string,
  projectPath: string | null,
  indexMtimeMs: number,
): void {
  stmts.metaUpsert.run(folder, projectPath, indexMtimeMs);
}

// --- FTS search queries ---

// biome-ignore lint/nursery/useExplicitType: inferred from db.transaction
const upsertSearchEntriesBatch = db.transaction((entries: SearchEntry[]) => {
  for (const e of entries) {
    const result = stmts.searchInsertMap.run(e.id, e.type, e.folder || null);
    stmts.searchInsertFts.run(
      result.lastInsertRowid,
      e.title || "",
      e.body || "",
    );
  }
});

export function deleteSearchSession(sessionId: string): void {
  stmts.searchDeleteBySession.run(sessionId);
  stmts.searchMapDeleteBySession.run(sessionId);
}

export function deleteSearchFolder(folder: string): void {
  stmts.searchDeleteByFolder.run(folder);
  stmts.searchMapDeleteByFolder.run(folder);
}

export function deleteSearchType(type: string): void {
  stmts.searchDeleteByType.run(type);
  stmts.searchMapDeleteByType.run(type);
}

export function upsertSearchEntries(entries: SearchEntry[]): void {
  upsertSearchEntriesBatch(entries);
}

export function searchByType(
  type: string,
  query: string,
  limit: number = 50,
): SearchResult[] {
  try {
    // Wrap in double quotes for exact substring matching with trigram tokenizer.
    // This prevents FTS5 from splitting on punctuation (e.g. "spec.md" → "spec" + "md")
    const escaped = `"${query.replace(/"/g, '""')}"`;
    return stmts.searchQuery.all(type, escaped, limit);
  } catch (e: unknown) {
    log.warn("[search] FTS query failed:", (e as Error).message);
    return [];
  }
}

export function isSearchIndexPopulated(): boolean {
  const row = db
    .prepare<[string], { cnt: number }>(
      "SELECT COUNT(*) as cnt FROM search_map WHERE type = ?",
    )
    .get("session");
  return row ? row.cnt > 0 : false;
}

// --- Settings queries ---

export function getSetting(key: string): unknown {
  const row = stmts.settingsGet.get(key);
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch (e: unknown) {
    log.warn(
      `[settings] JSON parse failed for key="${key}":`,
      (e as Error).message,
    );
    return row.value;
  }
}

export function setSetting(key: string, value: unknown): void {
  stmts.settingsUpsert.run(key, JSON.stringify(value));
}

export function deleteSetting(key: string): void {
  stmts.settingsDelete.run(key);
}
