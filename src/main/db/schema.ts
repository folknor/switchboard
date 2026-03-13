import type Database from "better-sqlite3";
import log from "electron-log";

/** Sequential migrations — each runs exactly once, in order. */
const MIGRATIONS: string[] = [
  // 001: initial schema
  `
  CREATE TABLE IF NOT EXISTS session_meta (
    sessionId TEXT PRIMARY KEY,
    name TEXT,
    starred INTEGER DEFAULT 0,
    archived INTEGER DEFAULT 0
  );

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
  );

  CREATE TABLE IF NOT EXISTS cache_meta (
    folder TEXT PRIMARY KEY,
    projectPath TEXT,
    indexMtimeMs REAL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_session_cache_folder ON session_cache(folder);
  CREATE INDEX IF NOT EXISTS idx_session_cache_slug ON session_cache(slug);

  CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
    title, body, tokenize='trigram'
  );

  CREATE TABLE IF NOT EXISTS search_map (
    rowid INTEGER PRIMARY KEY,
    id TEXT NOT NULL,
    type TEXT NOT NULL,
    folder TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_search_map_type_id ON search_map(type, id);
  `,
];

/** Run all pending migrations. Idempotent — tracks which have already run. */
export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    )
  `);

  const currentVersion =
    db
      .prepare<[], { version: number }>(
        "SELECT MAX(version) as version FROM schema_version",
      )
      .get()?.version ?? 0;

  for (let i = currentVersion; i < MIGRATIONS.length; i++) {
    const version = i + 1;
    log.info(`[db] running migration ${version}/${MIGRATIONS.length}`);
    db.exec(MIGRATIONS[i]);
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(version);
  }
}
