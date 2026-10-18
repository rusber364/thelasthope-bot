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
  /** Роли, с которыми записываются в основу (пусто — все), и роли, с которыми — только в запас. */
  mainRoleIds: string[];
  reserveRoleIds: string[];
}

export interface Signup {
  raidId: number;
  userId: string;
  specId: string;
  /** Ник на сервере в момент записи. */
  displayName: string | null;
  tentative: boolean;
  /** Записан только в запас (роль из «только в запас» у реги). */
  reserve: boolean;
  createdAt: number;
}

type Row = Record<string, unknown>;

const roleIds = (value: unknown): string[] => {
  if (typeof value !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
};

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
    mainRoleIds: roleIds(row.main_role_ids),
    reserveRoleIds: roleIds(row.reserve_role_ids),
  };
}

function toSignup(row: Row): Signup {
  return {
    raidId: Number(row.raid_id),
    userId: String(row.user_id),
    specId: String(row.spec_id),
    displayName: row.display_name == null ? null : String(row.display_name),
    tentative: Boolean(row.tentative),
    reserve: Boolean(row.reserve),
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
  mainRoleIds?: string[];
  reserveRoleIds?: string[];
}

export function createRaid(raid: NewRaid): Raid {
  const row = db
    .prepare(
      `INSERT INTO raids (guild_id, channel_id, title, description, starts_at, size, created_by, leader_name, schedule_key, main_role_ids, reserve_role_ids)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
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
      JSON.stringify(raid.mainRoleIds ?? []),
      JSON.stringify(raid.reserveRoleIds ?? []),
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

/** Перенести рейд: новое время начала, напоминания и «Сбор!» — заново от него. */
export function setRaidStart(id: number, startsAt: number): void {
  db.prepare('UPDATE raids SET starts_at = ?, reminded_day = 0, reminded_hour = 0, reminded_gather = 0 WHERE id = ?').run(startsAt, id);
  db.prepare('UPDATE raid_personal_reminders SET sent = 0 WHERE raid_id = ?').run(id);
}

// --- Личные напоминания («Напомнить» на реге) ---

export function getPersonalReminder(raidId: number, userId: string): number | null {
  const row = db.prepare('SELECT minutes FROM raid_personal_reminders WHERE raid_id = ? AND user_id = ?').get(raidId, userId) as { minutes: number } | undefined;
  return row ? Number(row.minutes) : null;
}

/** minutes = null — убрать напоминание. */
export function setPersonalReminder(raidId: number, userId: string, minutes: number | null): void {
  if (minutes === null) {
    db.prepare('DELETE FROM raid_personal_reminders WHERE raid_id = ? AND user_id = ?').run(raidId, userId);
    return;
  }
  db.prepare(
    'INSERT INTO raid_personal_reminders (raid_id, user_id, minutes) VALUES (?, ?, ?) ON CONFLICT (raid_id, user_id) DO UPDATE SET minutes = excluded.minutes, sent = 0',
  ).run(raidId, userId, minutes);
}

/** Личные напоминания, которым пора: рега открыта, до начала осталось не больше выбранных минут. */
export function duePersonalReminders(now: number): { raidId: number; userId: string; minutes: number }[] {
  return (
    db
      .prepare(
        `SELECT r.raid_id, r.user_id, r.minutes FROM raid_personal_reminders r JOIN raids ON raids.id = r.raid_id
         WHERE r.sent = 0 AND raids.status = 'open' AND raids.starts_at > ? AND raids.starts_at - r.minutes * 60000 <= ?`,
      )
      .all(now, now) as { raid_id: number; user_id: string; minutes: number }[]
  ).map((row) => ({ raidId: Number(row.raid_id), userId: String(row.user_id), minutes: Number(row.minutes) }));
}

export function markPersonalReminderSent(raidId: number, userId: string): void {
  db.prepare('UPDATE raid_personal_reminders SET sent = 1 WHERE raid_id = ? AND user_id = ?').run(raidId, userId);
}

/** Событие Discord, созданное для реги (null — его нет). */
export function getRaidEventId(id: number): string | null {
  const row = db.prepare('SELECT event_id FROM raids WHERE id = ?').get(id) as { event_id: string | null } | undefined;
  return row?.event_id ?? null;
}

export function setRaidEventId(id: number, eventId: string | null): void {
  db.prepare('UPDATE raids SET event_id = ? WHERE id = ?').run(eventId, id);
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

/** Открытые реги сервера — ближайшие первыми. */
export function upcomingRaids(guildId: string, limit = 20): Raid[] {
  return db
    .prepare("SELECT * FROM raids WHERE guild_id = ? AND status = 'open' ORDER BY starts_at ASC LIMIT ?")
    .all(guildId, limit)
    .map((row) => toRaid(row as Row));
}

/** Открытые реги, рейд которых уже начался, — пора закрывать запись. */
export function raidsToClose(now: number): Raid[] {
  return db
    .prepare(`SELECT * FROM raids WHERE status = 'open' AND starts_at <= ?`)
    .all(now)
    .map((row) => toRaid(row as Row));
}

/** day/hour — напоминания в личку, gather — «Сбор!» в канале реги. */
export type ReminderKind = 'day' | 'hour' | 'gather';

const REMINDER_COLUMNS: Record<ReminderKind, string> = {
  day: 'reminded_day',
  hour: 'reminded_hour',
  gather: 'reminded_gather',
};

/** Открытые реги, до начала которых осталось меньше lead мс, а напоминание ещё не отправлено. */
export function raidsDueForReminder(kind: ReminderKind, now: number, lead: number): Raid[] {
  return db
    .prepare(`SELECT * FROM raids WHERE status = 'open' AND ${REMINDER_COLUMNS[kind]} = 0 AND starts_at > ? AND starts_at - ? <= ?`)
    .all(now, lead, now)
    .map((row) => toRaid(row as Row));
}

export function markReminded(id: number, kind: ReminderKind): void {
  db.prepare(`UPDATE raids SET ${REMINDER_COLUMNS[kind]} = 1 WHERE id = ?`).run(id);
}

/** Реги, у участников которых пора снять временную роль: отменённые или начавшиеся больше holdMs назад. */
export function raidsDueForRoleCleanup(now: number, holdMs: number): Raid[] {
  return db
    .prepare(`SELECT * FROM raids WHERE role_cleaned = 0 AND (status = 'cancelled' OR starts_at + ? <= ?)`)
    .all(holdMs, now)
    .map((row) => toRaid(row as Row));
}

export function markRoleCleaned(id: number): void {
  db.prepare('UPDATE raids SET role_cleaned = 1 WHERE id = ?').run(id);
}

/** Записан ли игрок ещё на какую-то регу, по которой временная роль пока нужна. */
export function hasOtherActiveSignup(userId: string, exceptRaidId: number, now: number, holdMs: number): boolean {
  return (
    db
      .prepare(
        `SELECT 1 FROM raid_signups s JOIN raids r ON r.id = s.raid_id
         WHERE s.user_id = ? AND r.id != ? AND r.status != 'cancelled' AND r.role_cleaned = 0 AND r.starts_at + ? > ?
         LIMIT 1`,
      )
      .get(userId, exceptRaidId, holdMs, now) !== undefined
  );
}

/** Реги, которые пора архивировать: начались больше delay мс назад (в том числе отменённые). */
export function raidsDueForArchive(now: number, delay: number): Raid[] {
  return db
    .prepare('SELECT * FROM raids WHERE archived = 0 AND message_id IS NOT NULL AND starts_at + ? <= ?')
    .all(delay, now)
    .map((row) => toRaid(row as Row));
}

/** Рега заархивирована: сообщения больше нет, перерисовывать нечего. */
export function markArchived(id: number): void {
  db.prepare('UPDATE raids SET archived = 1, message_id = NULL WHERE id = ?').run(id);
}

export type AttendanceStatus = 'present' | 'absent' | 'tentative_absent' | 'walkin';

/** Неотменённые реги, с начала которых прошло delay мс (но не больше 6 часов), а посещаемость ещё не проверена. */
export function raidsDueForAttendance(now: number, delay: number): Raid[] {
  return db
    .prepare(
      `SELECT * FROM raids WHERE status != 'cancelled' AND attendance_done = 0
       AND starts_at + ? <= ? AND starts_at + ? > ?`,
    )
    .all(delay, now, delay, now - 6 * 60 * 60 * 1000)
    .map((row) => toRaid(row as Row));
}

export function markAttendanceDone(id: number): void {
  db.prepare('UPDATE raids SET attendance_done = 1 WHERE id = ?').run(id);
}

/** Сколько человек в каждом статусе посещаемости (пусто — посещаемость не проверялась). */
export function attendanceCounts(raidId: number): Partial<Record<AttendanceStatus, number>> {
  const rows = db.prepare('SELECT status, COUNT(*) AS n FROM raid_attendance WHERE raid_id = ? GROUP BY status').all(raidId) as { status: AttendanceStatus; n: number }[];
  return Object.fromEntries(rows.map((row) => [row.status, Number(row.n)]));
}

export function saveAttendance(raidId: number, rows: { userId: string; status: AttendanceStatus }[]): void {
  const insert = db.prepare(
    'INSERT INTO raid_attendance (raid_id, user_id, status) VALUES (?, ?, ?) ON CONFLICT (raid_id, user_id) DO UPDATE SET status = excluded.status',
  );
  for (const row of rows) insert.run(raidId, row.userId, row.status);
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
/** reserve пересчитывается при каждой смене спека — например, гость стал рейдером и переходит в основу. */
export function upsertSignup(raidId: number, userId: string, specId: string, displayName: string, reserve = false): void {
  db.prepare(
    `INSERT INTO raid_signups (raid_id, user_id, spec_id, display_name, reserve, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (raid_id, user_id) DO UPDATE SET spec_id = excluded.spec_id, display_name = excluded.display_name, reserve = excluded.reserve`,
  ).run(raidId, userId, specId, displayName, reserve ? 1 : 0, Date.now());
}

export function setTentative(raidId: number, userId: string, tentative: boolean): void {
  db.prepare('UPDATE raid_signups SET tentative = ? WHERE raid_id = ? AND user_id = ?').run(tentative ? 1 : 0, raidId, userId);
}

export function removeSignup(raidId: number, userId: string): boolean {
  return db.prepare('DELETE FROM raid_signups WHERE raid_id = ? AND user_id = ?').run(raidId, userId).changes > 0;
}

/** Своя картинка реги (из создания по шагам в личке). У остальных рег — общий фон из assets. */
export interface RaidImage {
  /** Имя файла вложения, например raid-image.png. */
  name: string;
  data: Buffer;
}

export function saveRaidImage(raidId: number, image: RaidImage): void {
  db.prepare('INSERT INTO raid_images (raid_id, name, data) VALUES (?, ?, ?) ON CONFLICT (raid_id) DO UPDATE SET name = excluded.name, data = excluded.data').run(
    raidId,
    image.name,
    image.data,
  );
}

export function getRaidImage(raidId: number): RaidImage | null {
  const row = db.prepare('SELECT name, data FROM raid_images WHERE raid_id = ?').get(raidId) as { name: string; data: Uint8Array } | undefined;
  return row ? { name: row.name, data: Buffer.from(row.data) } : null;
}
