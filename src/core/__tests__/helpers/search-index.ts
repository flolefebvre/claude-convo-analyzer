import type Database from "better-sqlite3";

export const SEARCH_INDEX_MIGRATION = "20260804000000_search_fts5";

export function dropSearchIndex(db: Database.Database): void {
  for (const stmt of [
    'DROP TRIGGER IF EXISTS "message_fts_insert"',
    'DROP TRIGGER IF EXISTS "message_fts_delete"',
    'DROP TRIGGER IF EXISTS "message_fts_update"',
    'DROP TRIGGER IF EXISTS "conversation_title_fts_insert"',
    'DROP TRIGGER IF EXISTS "conversation_title_fts_delete"',
    'DROP TRIGGER IF EXISTS "conversation_title_fts_update"',
    'DROP TABLE IF EXISTS "message_fts"',
    'DROP TABLE IF EXISTS "conversation_title_fts"',
  ]) {
    db.exec(stmt);
  }
  db.prepare("DELETE FROM _cca_migrations WHERE migration_name = ?").run(SEARCH_INDEX_MIGRATION);
}
