import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import log from "electron-log";

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

db.exec(`
  CREATE TABLE IF NOT EXISTS session_meta (
    sessionId TEXT PRIMARY KEY,
    name TEXT,
    starred INTEGER DEFAULT 0,
    archived INTEGER DEFAULT 0
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS session_cache (
    sessionId TEXT PRIMARY KEY,
    folder TEXT NOT NULL,
    projectPath TEXT,
    summary TEXT,
    firstPrompt TEXT,
    created TEXT,
    modified TEXT,
    messageCount INTEGER DEFAULT 0,
    slug TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS cache_meta (
    folder TEXT PRIMARY KEY,
    projectPath TEXT,
    indexMtimeMs REAL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )
`);

// Index for fast folder lookups
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_session_cache_folder ON session_cache(folder)",
);
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_session_cache_slug ON session_cache(slug)",
);

// --- FTS5 full-text search ---
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
    title, body, tokenize='trigram'
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS search_map (
    rowid INTEGER PRIMARY KEY,
    id TEXT NOT NULL,
    type TEXT NOT NULL,
    folder TEXT
  )
`);

db.exec(
  "CREATE INDEX IF NOT EXISTS idx_search_map_type_id ON search_map(type, id)",
);

interface SessionMetaRow {
  sessionId: string;
  name: string | null;
  starred: number;
  archived: number;
}

interface SessionCacheRow {
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

interface CacheMetaRow {
  folder: string;
  projectPath: string | null;
  indexMtimeMs: number;
}

interface SearchResultRow {
  id: string;
  snippet: string;
}

interface SessionInput {
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

interface SearchEntry {
  id: string;
  type: string;
  folder?: string | null;
  title?: string;
  body?: string;
}

// biome-ignore lint/nursery/useExplicitType: complex inferred type from prepared statements
const stmts = {
  get: db.prepare<[string], SessionMetaRow>(
    "SELECT * FROM session_meta WHERE sessionId = ?",
  ),
  getAll: db.prepare<[], SessionMetaRow>("SELECT * FROM session_meta"),
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
  // Session cache statements
  cacheCount: db.prepare<[], { cnt: number }>(
    "SELECT COUNT(*) as cnt FROM session_cache",
  ),
  cacheGetAll: db.prepare<[], SessionCacheRow>("SELECT * FROM session_cache"),
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
  // Cache meta statements
  metaGet: db.prepare<[string], CacheMetaRow>(
    "SELECT * FROM cache_meta WHERE folder = ?",
  ),
  metaGetAll: db.prepare<[], CacheMetaRow>("SELECT * FROM cache_meta"),
  metaUpsert: db.prepare<[string, string | null, number]>(`
    INSERT INTO cache_meta (folder, projectPath, indexMtimeMs)
    VALUES (?, ?, ?)
    ON CONFLICT(folder) DO UPDATE SET
      projectPath = excluded.projectPath, indexMtimeMs = excluded.indexMtimeMs
  `),
  metaDelete: db.prepare<[string]>("DELETE FROM cache_meta WHERE folder = ?"),
  // FTS search statements
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
  // Settings statements
  settingsGet: db.prepare<[string], { value: string }>(
    "SELECT value FROM settings WHERE key = ?",
  ),
  settingsUpsert: db.prepare<[string, string]>(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `),
  settingsDelete: db.prepare<[string]>("DELETE FROM settings WHERE key = ?"),
  searchQuery: db.prepare<[string, string, number], SearchResultRow>(`
    SELECT search_map.id, snippet(search_fts, 1, '<mark>', '</mark>', '...', 40) as snippet
    FROM search_fts
    JOIN search_map ON search_fts.rowid = search_map.rowid
    WHERE search_map.type = ? AND search_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `),
};

function getMeta(sessionId: string): SessionMetaRow | null {
  return stmts.get.get(sessionId) || null;
}

function getAllMeta(): Map<string, SessionMetaRow> {
  const rows = stmts.getAll.all();
  const map = new Map<string, SessionMetaRow>();
  for (const row of rows) map.set(row.sessionId, row);
  return map;
}

function setName(sessionId: string, name: string | null): void {
  stmts.upsertName.run(sessionId, name);
}

function toggleStar(sessionId: string): number {
  stmts.upsertStar.run(sessionId);
  const row = stmts.get.get(sessionId);
  if (!row) return 0;
  return row.starred;
}

function setArchived(sessionId: string, archived: boolean): void {
  stmts.upsertArchived.run(sessionId, archived ? 1 : 0);
}

// --- Session cache functions ---

function isCachePopulated(): boolean {
  const row = stmts.cacheCount.get();
  return row ? row.cnt > 0 : false;
}

function getAllCached(): SessionCacheRow[] {
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

function upsertCachedSessions(sessions: SessionInput[]): void {
  upsertCachedSessionsBatch(sessions);
}

function getCachedByFolder(
  folder: string,
): { sessionId: string; modified: string }[] {
  return stmts.cacheGetByFolder.all(folder);
}

function getCachedFolder(sessionId: string): string | null {
  const row = stmts.cacheGetFolder.get(sessionId);
  return row ? row.folder : null;
}

function deleteCachedSession(sessionId: string): void {
  stmts.cacheDeleteSession.run(sessionId);
}

function deleteCachedFolder(folder: string): void {
  stmts.cacheDeleteFolder.run(folder);
  stmts.metaDelete.run(folder);
}

function getFolderMeta(folder: string): CacheMetaRow | null {
  return stmts.metaGet.get(folder) || null;
}

function getAllFolderMeta(): Map<string, CacheMetaRow> {
  const rows = stmts.metaGetAll.all();
  const map = new Map<string, CacheMetaRow>();
  for (const row of rows) map.set(row.folder, row);
  return map;
}

function setFolderMeta(
  folder: string,
  projectPath: string | null,
  indexMtimeMs: number,
): void {
  stmts.metaUpsert.run(folder, projectPath, indexMtimeMs);
}

// --- FTS search functions ---

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

function deleteSearchSession(sessionId: string): void {
  stmts.searchDeleteBySession.run(sessionId);
  stmts.searchMapDeleteBySession.run(sessionId);
}

function deleteSearchFolder(folder: string): void {
  stmts.searchDeleteByFolder.run(folder);
  stmts.searchMapDeleteByFolder.run(folder);
}

function deleteSearchType(type: string): void {
  stmts.searchDeleteByType.run(type);
  stmts.searchMapDeleteByType.run(type);
}

function upsertSearchEntries(entries: SearchEntry[]): void {
  upsertSearchEntriesBatch(entries);
}

function searchByType(
  type: string,
  query: string,
  limit: number = 50,
): SearchResultRow[] {
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

function isSearchIndexPopulated(): boolean {
  const row = db
    .prepare<[string], { cnt: number }>(
      "SELECT COUNT(*) as cnt FROM search_map WHERE type = ?",
    )
    .get("session");
  return row ? row.cnt > 0 : false;
}

// --- Settings functions ---

function getSetting(key: string): unknown {
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

function setSetting(key: string, value: unknown): void {
  stmts.settingsUpsert.run(key, JSON.stringify(value));
}

function deleteSetting(key: string): void {
  stmts.settingsDelete.run(key);
}

export {
  deleteCachedFolder,
  deleteCachedSession,
  deleteSearchFolder,
  deleteSearchSession,
  deleteSearchType,
  deleteSetting,
  getAllCached,
  getAllFolderMeta,
  getAllMeta,
  getCachedByFolder,
  getCachedFolder,
  getFolderMeta,
  getMeta,
  getSetting,
  isCachePopulated,
  isSearchIndexPopulated,
  searchByType,
  setArchived,
  setFolderMeta,
  setName,
  setSetting,
  toggleStar,
  upsertCachedSessions,
  upsertSearchEntries,
};
