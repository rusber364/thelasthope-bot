// Чтение и запись рег в базу данных.
import { db } from '../db.ts';

export type RaidStatus = 'open' | 'closed' | 'cancelled';

export interface Raid {
  id: number;
  guildId: string;
  channelId: string;
  messageId: string | null;
  title: string;
  description: string | null;
  startsAt: number;
  size: number;
  createdBy: string;
  /** Кто ведёт рейд — показывается в шапке реги. */
  leaderName: string | null;
  status: RaidStatus;
}

export interface Signup {
  raidId: number;
  userId: string;
  specId: string;
  /** Ник на сервере в момент записи. */
  displayName: string | null;
  tentative: boolean;
  createdAt: number;
}

type Row = Record<string, unknown>;

function toRaid(row: Row): Raid {
  return {
    id: Number(row.id),
    guildId: String(row.guild_id),
    channelId: String(row.channel_id),
    messageId: row.message_id == null ? null : String(row.message_id),
    title: String(row.title),
    description: row.description == null ? null : String(row.description),
    startsAt: Number(row.starts_at),
    size: Number(row.size),
    createdBy: String(row.created_by),
    leaderName: row.leader_name == null ? null : String(row.leader_name),
    status: String(row.status) as RaidStatus,
  };
}

function toSignup(row: Row): Signup {
  return {
    raidId: Number(row.raid_id),
    userId: String(row.user_id),
    specId: String(row.spec_id),
    displayName: row.display_name == null ? null : String(row.display_name),
    tentative: Boolean(row.tentative),
    createdAt: Number(row.created_at),
  };
}

export interface NewRaid {
  guildId: string;
  channelId: string;
  title: string;
  description?: string | null;
  startsAt: number;
  size: number;
  createdBy: string;
  leaderName?: string | null;
  scheduleKey?: string | null;
}

export function createRaid(raid: NewRaid): Raid {
  const row = db
    .prepare(
      `INSERT INTO raids (guild_id, channel_id, title, description, starts_at, size, created_by, leader_name, schedule_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    )
    .get(
      raid.guildId,
      raid.channelId,
      raid.title,
      raid.description ?? null,
      raid.startsAt,
      raid.size,
      raid.createdBy,
      raid.leaderName ?? null,
      raid.scheduleKey ?? null,
    );
  return toRaid(row as Row);
}

export function deleteRaid(id: number): void {
  db.prepare('DELETE FROM raids WHERE id = ?').run(id);
}

export function setRaidMessage(id: number, messageId: string): void {
  db.prepare('UPDATE raids SET message_id = ? WHERE id = ?').run(messageId, id);
}

export function setRaidStatus(id: number, status: RaidStatus): void {
  db.prepare('UPDATE raids SET status = ? WHERE id = ?').run(status, id);
}

export function getRaid(id: number): Raid | null {
  const row = db.prepare('SELECT * FROM raids WHERE id = ?').get(id);
  return row ? toRaid(row as Row) : null;
}

export function scheduleKeyExists(key: string): boolean {
  return db.prepare('SELECT 1 FROM raids WHERE schedule_key = ?').get(key) !== undefined;
}

/** Последние реги сервера — для подсказок в командах. */
export function listRaids(guildId: string, status: RaidStatus, limit = 25): Raid[] {
  return db
    .prepare('SELECT * FROM raids WHERE guild_id = ? AND status = ? ORDER BY starts_at DESC LIMIT ?')
    .all(guildId, status, limit)
    .map((row) => toRaid(row as Row));
}

/** Открытые реги, рейд которых уже начался, — пора закрывать запись. */
export function raidsToClose(now: number): Raid[] {
  return db
    .prepare(`SELECT * FROM raids WHERE status = 'open' AND starts_at <= ?`)
    .all(now)
    .map((row) => toRaid(row as Row));
}

export type ReminderKind = 'day' | 'hour';

/** Открытые реги, до начала которых осталось меньше lead мс, а напоминание ещё не отправлено. */
export function raidsDueForReminder(kind: ReminderKind, now: number, lead: number): Raid[] {
  const column = kind === 'day' ? 'reminded_day' : 'reminded_hour';
  return db
    .prepare(`SELECT * FROM raids WHERE status = 'open' AND ${column} = 0 AND starts_at > ? AND starts_at - ? <= ?`)
    .all(now, lead, now)
    .map((row) => toRaid(row as Row));
}

export function markReminded(id: number, kind: ReminderKind): void {
  const column = kind === 'day' ? 'reminded_day' : 'reminded_hour';
  db.prepare(`UPDATE raids SET ${column} = 1 WHERE id = ?`).run(id);
}

export function getSignups(raidId: number): Signup[] {
  return db
    .prepare('SELECT * FROM raid_signups WHERE raid_id = ? ORDER BY created_at, rowid')
    .all(raidId)
    .map((row) => toSignup(row as Row));
}

export function getSignup(raidId: number, userId: string): Signup | null {
  const row = db.prepare('SELECT * FROM raid_signups WHERE raid_id = ? AND user_id = ?').get(raidId, userId);
  return row ? toSignup(row as Row) : null;
}

/** Записать или сменить спек. При смене спека место в очереди (и номер) сохраняется. */
export function upsertSignup(raidId: number, userId: string, specId: string, displayName: string): void {
  db.prepare(
    `INSERT INTO raid_signups (raid_id, user_id, spec_id, display_name, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (raid_id, user_id) DO UPDATE SET spec_id = excluded.spec_id, display_name = excluded.display_name`,
  ).run(raidId, userId, specId, displayName, Date.now());
}

export function setTentative(raidId: number, userId: string, tentative: boolean): void {
  db.prepare('UPDATE raid_signups SET tentative = ? WHERE raid_id = ? AND user_id = ?').run(tentative ? 1 : 0, raidId, userId);
}

export function removeSignup(raidId: number, userId: string): boolean {
  return db.prepare('DELETE FROM raid_signups WHERE raid_id = ? AND user_id = ?').run(raidId, userId).changes > 0;
}
