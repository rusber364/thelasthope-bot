// База данных — один файл data/bot.db (SQLite встроен в Node, ничего ставить не нужно).
// Здесь хранится то, что должно пережить перезапуск бота: реги, записи, опросы и ответы.
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const dataDir = new URL('../data/', import.meta.url);
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(new URL('bot.db', dataDir));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS raids (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id      TEXT    NOT NULL,
    channel_id    TEXT    NOT NULL,
    message_id    TEXT,
    title         TEXT    NOT NULL,
    description   TEXT,
    starts_at     INTEGER NOT NULL,
    size          INTEGER NOT NULL,
    created_by    TEXT    NOT NULL,
    schedule_key  TEXT    UNIQUE,
    reminded_day  INTEGER NOT NULL DEFAULT 0,
    reminded_hour INTEGER NOT NULL DEFAULT 0,
    status        TEXT    NOT NULL DEFAULT 'open'  -- open | closed | cancelled
  );

  CREATE TABLE IF NOT EXISTS raid_signups (
    raid_id    INTEGER NOT NULL REFERENCES raids(id) ON DELETE CASCADE,
    user_id    TEXT    NOT NULL,
    spec_id    TEXT    NOT NULL,
    tentative  INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (raid_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS polls (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT    NOT NULL,
    channel_id TEXT    NOT NULL,
    message_id TEXT,
    definition TEXT    NOT NULL,
    created_by TEXT    NOT NULL,
    created_at INTEGER NOT NULL,
    closed     INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS poll_responses (
    poll_id      INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    user_id      TEXT    NOT NULL,
    answers      TEXT    NOT NULL DEFAULT '{}',
    completed_at INTEGER,
    updated_at   INTEGER NOT NULL,
    PRIMARY KEY (poll_id, user_id)
  );
`);

/** Добавляет колонку в уже существующую базу (для баз, созданных старой версией бота). */
function addColumn(table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

addColumn('raids', 'leader_name', 'TEXT');
addColumn('raid_signups', 'display_name', 'TEXT');
