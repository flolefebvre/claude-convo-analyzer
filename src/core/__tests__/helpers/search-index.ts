// Test-only surgery on the FTS5 search index (issue #45).
//
// The index is a set of virtual tables + triggers created by a raw-SQL
// migration, so tests that REWIND the schema — to replay a migration, or to
// simulate a database from before a column existed — have to take the index
// down first: its triggers reference `message.kind`, which such a rewind drops.
//
// Not a test file: it declares no tests and lives under `__tests__/helpers/`,
// which vitest's `include` excludes (see `vitest.config.ts`).

import type Database from "better-sqlite3";

/** The migration that creates the search index (its `_cca_migrations` name). */
export const SEARCH_INDEX_MIGRATION = "20260804000000_search_fts5";

/**
 * Drop the search index — triggers, virtual tables, and its ledger entry — so
 * the database looks like one from before search existed. Re-opening the
 * database through `createPrismaClient` re-applies the migration (and its
 * backfill).
 */
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
  db.prepare("DELETE FROM _cca_migrations WHERE migration_name = ?").run(
    SEARCH_INDEX_MIGRATION,
  );
}
