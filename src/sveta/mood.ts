// Настроение Светы на сегодня (день — по Киеву). Основа дня зависит только от даты — весь день одна и та же; сверху —
// события: как с ней обходились (change_attitude, пересказ разговора) и что со сборами (рега, «Сбор!», перенос, отмена).
// Слегка окрашивает ответы и видно в админке. Модель его прямо не меняет — считает код.
import { db } from '../db.ts';
import { dayKey } from './limits.ts';

/** Сколько событий за день помним (для причин в подсказке и админке) и предел накопленного. */
const REASONS = 5;
const LIMIT = 3;

export interface DayMood {
  score: number;
  reasons: string[];
}

export function moodOn(guildId: string, day: string): DayMood {
  const row = db.prepare('SELECT score, reasons FROM sveta_mood WHERE guild_id = ? AND day = ?').get(guildId, day) as
    | { score: number; reasons: string }
    | undefined;
  if (!row) return { score: 0, reasons: [] };
  let reasons: string[] = [];
  try {
    const parsed = JSON.parse(row.reasons) as unknown;
    if (Array.isArray(parsed)) reasons = parsed.filter((r): r is string => typeof r === 'string');
  } catch {
    // повреждённые причины — без них
  }
  return { score: Number(row.score), reasons };
}

/** Событие дня: delta — насколько оно подняло (+) или испортило (−) настроение. */
export function addMood(guildId: string, now: number, delta: number, reason: string): void {
  if (!delta) return;
  const day = dayKey(now);
  const mood = moodOn(guildId, day);
  const score = Math.max(-LIMIT, Math.min(LIMIT, mood.score + delta));
  // Одинаковые причины подряд не копим: «тебя порадовали» пять раз — одна строка.
  const reasons = mood.reasons.at(-1) === reason ? mood.reasons : [...mood.reasons, reason].slice(-REASONS);
  db.prepare(
    `INSERT INTO sveta_mood (guild_id, day, score, reasons) VALUES (?, ?, ?, ?)
     ON CONFLICT (guild_id, day) DO UPDATE SET score = excluded.score, reasons = excluded.reasons`,
  ).run(guildId, day, score, JSON.stringify(reasons));
}

/** Основа дня от −1 до 1: зависит только от даты, поэтому весь день одна. */
export function daySeed(day: string): number {
  let hash = 0;
  for (const char of day) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return ((hash % 2001) - 1000) / 1000;
}

const LEVELS = [
  { below: -1.5, text: 'хмурое — отвечаешь суше и ворчливее обычного' },
  { below: -0.5, text: 'так себе — чуть ворчливее обычного' },
  { below: 0.5, text: 'ровное' },
  { below: 1.5, text: 'хорошее — шутишь охотнее' },
  { below: Infinity, text: 'отличное — так и сияешь' },
] as const;

/** Настроение словами (чистая функция): основа дня весит меньше, чем события. */
export function moodOf(mood: DayMood, seed: number): string {
  const total = seed * 0.6 + mood.score;
  const level = LEVELS.find((l) => total < l.below)!.text;
  return mood.reasons.length ? `${level} (сегодня: ${mood.reasons.join(', ')})` : level;
}

/** Настроение на сейчас — для подсказки и админки. */
export function moodText(guildId: string, now: number): string {
  const day = dayKey(now);
  return moodOf(moodOn(guildId, day), daySeed(day));
}

// --- Откуда берётся настроение ---

/** Света поменяла отношение к человеку: обидели — хуже, порадовали — лучше. */
export function moodFromAttitude(guildId: string, now: number, change: number): void {
  addMood(guildId, now, Math.max(-1, Math.min(1, change / 20)), change > 0 ? 'тебя порадовали' : 'тебя задели');
}

/** Модель памяти оценила разговор от −2 до 2. */
export function moodFromConversation(guildId: string, now: number, mood: number): void {
  addMood(guildId, now, mood / 2, mood > 0 ? 'был весёлый разговор' : 'был неприятный разговор');
}

export type RaidMood = 'open' | 'gather' | 'move' | 'cancel';
const RAID_MOOD: Record<RaidMood, [number, string]> = {
  open: [0.3, 'открыли регу'],
  gather: [0.5, 'собираются в рейд'],
  move: [-0.3, 'перенесли сбор'],
  cancel: [-1, 'отменили сбор'],
};

/** Новости о сборах. */
export function moodFromRaid(guildId: string, now: number, news: RaidMood): void {
  const [delta, reason] = RAID_MOOD[news];
  addMood(guildId, now, delta, reason);
}
