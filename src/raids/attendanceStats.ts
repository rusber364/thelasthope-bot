// Статистика посещаемости: сводка по отметкам, которые бот ставит через N минут после начала рейда
// (raid_attendance). Отметка «под вопросом» берётся из записи на регу.
import { db } from '../db.ts';
import type { ActivityKind } from './kinds.ts';
import type { AttendanceStatus } from './store.ts';

/** Как человек отметился на одном рейде. */
export type AttendanceKind = 'present' | 'tentativePresent' | 'absent' | 'tentativeAbsent' | 'walkin';

export const KIND_LABELS: Record<AttendanceKind, string> = {
  present: '✅ на рейде',
  tentativePresent: '☑️ «под вопросом», но на рейде',
  absent: '❌ пропуск',
  tentativeAbsent: '❔ «под вопросом», не было',
  walkin: '➕ без записи, но на рейде',
};

export interface AttendanceRecord {
  raidId: number;
  title: string;
  startsAt: number;
  userId: string;
  kind: AttendanceKind;
}

export interface PlayerSummary {
  userId: string;
  present: number;
  tentativePresent: number;
  absent: number;
  tentativeAbsent: number;
  walkin: number;
  /** На рейде / (на рейде + пропуски), в процентах; null — не с чем сравнивать. Не пришедшие «под вопросом» предупредили и не считаются. */
  rate: number | null;
}

export function kindOf(status: AttendanceStatus, tentative: boolean): AttendanceKind {
  if (status === 'present') return tentative ? 'tentativePresent' : 'present';
  if (status === 'absent') return 'absent';
  if (status === 'tentative_absent') return 'tentativeAbsent';
  return 'walkin';
}

/** Сводка по игрокам (чистая функция): сначала те, кто чаще пропускает, — на них офицерам смотреть в первую очередь. */
export function summarize(records: AttendanceRecord[]): PlayerSummary[] {
  const byUser = new Map<string, PlayerSummary>();
  for (const record of records) {
    const row = byUser.get(record.userId) ?? { userId: record.userId, present: 0, tentativePresent: 0, absent: 0, tentativeAbsent: 0, walkin: 0, rate: null };
    row[record.kind] += 1;
    byUser.set(record.userId, row);
  }
  for (const row of byUser.values()) {
    const came = row.present + row.tentativePresent;
    row.rate = came + row.absent ? Math.round((came / (came + row.absent)) * 100) : null;
  }
  return [...byUser.values()].sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101) || b.absent - a.absent);
}

/** Отметки за период [from, to) — по времени начала рейда. userId — только один игрок. */
/** kind — только сборы этого вида (без него — все). */
export function attendanceRecords(guildId: string, from: number, to: number, userId?: string, kind?: ActivityKind): AttendanceRecord[] {
  const rows = db
    .prepare(
      `SELECT r.id AS raid_id, r.title, r.starts_at, a.user_id, a.status, COALESCE(s.tentative, 0) AS tentative
       FROM raid_attendance a
       JOIN raids r ON r.id = a.raid_id
       LEFT JOIN raid_signups s ON s.raid_id = a.raid_id AND s.user_id = a.user_id
       WHERE r.guild_id = ? AND r.starts_at >= ? AND r.starts_at < ? ${userId ? 'AND a.user_id = ?' : ''} ${kind ? 'AND r.kind = ?' : ''}
       ORDER BY r.starts_at DESC`,
    )
    .all(...[guildId, from, to, ...(userId ? [userId] : []), ...(kind ? [kind] : [])]) as { raid_id: number; title: string; starts_at: number; user_id: string; status: AttendanceStatus; tentative: number }[];
  return rows.map((row) => ({
    raidId: Number(row.raid_id),
    title: String(row.title),
    startsAt: Number(row.starts_at),
    userId: String(row.user_id),
    kind: kindOf(row.status, Boolean(row.tentative)),
  }));
}

/** Сколько рейдов за период проверено на посещаемость. */
export function checkedRaids(guildId: string, from: number, to: number, kind?: ActivityKind): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM raids WHERE guild_id = ? AND attendance_done = 1 AND player = 0 AND starts_at >= ? AND starts_at < ? ${kind ? 'AND kind = ?' : ''}`)
    .get(...[guildId, from, to, ...(kind ? [kind] : [])]) as { n: number };
  return Number(row.n);
}
