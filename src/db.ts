// База данных — один файл data/bot.db (SQLite встроен в Node, ничего ставить не нужно).
// Здесь хранится то, что должно пережить перезапуск бота: настройки, реги, записи, опросы и ответы.
// BOT_DB_PATH переопределяет путь (в тестах — ":memory:").
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

function openDatabase(): DatabaseSync {
  const custom = process.env.BOT_DB_PATH;
  if (custom) return new DatabaseSync(custom);
  const dataDir = new URL('../data/', import.meta.url);
  mkdirSync(dataDir, { recursive: true });
  return new DatabaseSync(new URL('bot.db', dataDir));
}

export const db = openDatabase();

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
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

/** Добавляет колонку в уже существующую базу (для баз, созданных старой версией бота). true — колонку только что добавили. */
function addColumn(table: string, column: string, definition: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (columns.some((c) => c.name === column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}

addColumn('raids', 'leader_name', 'TEXT');
addColumn('raid_signups', 'display_name', 'TEXT');
addColumn('raids', 'reminded_gather', 'INTEGER NOT NULL DEFAULT 0');
addColumn('raids', 'attendance_done', 'INTEGER NOT NULL DEFAULT 0');
addColumn('raids', 'role_cleaned', 'INTEGER NOT NULL DEFAULT 0');
addColumn('raids', 'archived', 'INTEGER NOT NULL DEFAULT 0');
addColumn('raids', 'event_id', 'TEXT'); // событие Discord для реги
// Кто может записаться (JSON-списки ролей из шаблона на момент создания; пусто — все) и кто записан только в запас.
addColumn('raids', 'main_role_ids', 'TEXT');
addColumn('raids', 'reserve_role_ids', 'TEXT');
addColumn('raid_signups', 'reserve', 'INTEGER NOT NULL DEFAULT 0');
// Получил ли записавшийся общее напоминание в личку. Кто записался после него, получит своё за 15 минут до начала.
// В старой базе те, кому напоминание «за час» уже ушло, отмечаются сразу — иначе им пришло бы второе.
if (addColumn('raid_signups', 'reminded', 'INTEGER NOT NULL DEFAULT 0')) {
  db.exec('UPDATE raid_signups SET reminded = 1 WHERE raid_id IN (SELECT id FROM raids WHERE reminded_hour = 1)');
}
// Исходный текст опроса — чтобы в админке можно было создать копию и поправить.
addColumn('polls', 'source', 'TEXT');

// Создание реги по шагам в личке: один черновик на офицера (переживает перезапуск бота)
// и своя картинка реги — её заново прикрепляют при каждой перерисовке сообщения.
db.exec(`
  CREATE TABLE IF NOT EXISTS raid_drafts (
    user_id           TEXT    PRIMARY KEY,
    guild_id          TEXT    NOT NULL,
    channel_id        TEXT    NOT NULL,
    ping_role_id      TEXT,
    size              INTEGER NOT NULL,
    leader_name       TEXT,
    step              TEXT    NOT NULL,
    title             TEXT,
    description       TEXT,
    date              TEXT,
    time              TEXT,
    image             BLOB,
    image_name        TEXT,
    editing           INTEGER NOT NULL DEFAULT 0,
    prompt_message_id TEXT,
    updated_at        INTEGER NOT NULL
  );

  -- Личные напоминания: за сколько минут до рейда написать человеку в личку.
  CREATE TABLE IF NOT EXISTS raid_personal_reminders (
    raid_id INTEGER NOT NULL REFERENCES raids(id) ON DELETE CASCADE,
    user_id TEXT    NOT NULL,
    minutes INTEGER NOT NULL,
    sent    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (raid_id, user_id)
  );

  -- Временные каналы: когда удалить.
  CREATE TABLE IF NOT EXISTS temp_channels (
    channel_id TEXT    PRIMARY KEY,
    guild_id   TEXT    NOT NULL,
    expires_at INTEGER NOT NULL,
    created_by TEXT    NOT NULL
  );

  -- Роли с панели на время: когда снять.
  CREATE TABLE IF NOT EXISTS temp_roles (
    guild_id   TEXT    NOT NULL,
    user_id    TEXT    NOT NULL,
    role_id    TEXT    NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id, role_id)
  );

  -- Живой список ближайших рейдов: какое сообщение бот обновляет.
  CREATE TABLE IF NOT EXISTS raid_boards (
    guild_id   TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS raid_images (
    raid_id INTEGER PRIMARY KEY REFERENCES raids(id) ON DELETE CASCADE,
    name    TEXT    NOT NULL,
    data    BLOB    NOT NULL
  );
`);

// Липкие сообщения: id последней копии в канале — чтобы удалить её и после перезапуска.
db.exec(`
  CREATE TABLE IF NOT EXISTS sticky_messages (
    channel_id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL
  );
`);
// Что было опубликовано (текст и роли): упомянутые роли получают уведомление, только когда это меняется.
addColumn('sticky_messages', 'signature', 'TEXT');

// Кто пришёл на рейд (по голосовому каналу) — основа для будущей статистики посещаемости.
db.exec(`
  CREATE TABLE IF NOT EXISTS raid_attendance (
    raid_id INTEGER NOT NULL REFERENCES raids(id) ON DELETE CASCADE,
    user_id TEXT    NOT NULL,
    status  TEXT    NOT NULL,  -- present | absent | tentative_absent | walkin
    PRIMARY KEY (raid_id, user_id)
  );
`);

// Лог бота: всё, что он пишет в консоль (страница «Лог бота» в админке). Хранятся последние строки — см. src/lib/botLog.ts.
db.exec(`
  CREATE TABLE IF NOT EXISTS bot_log (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    at    INTEGER NOT NULL,
    level TEXT    NOT NULL,  -- start | info | warn | error
    text  TEXT    NOT NULL
  );
`);
