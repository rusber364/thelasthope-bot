// Виды сборов: рейд, подземелье, PvP-группа. Запись, расписание, напоминания и запас у всех общие —
// вид меняет только размер и лимиты по ролям по умолчанию и слово в сообщениях бота.
import type { RaidRole } from './classes.ts';

export type ActivityKind = 'raid' | 'dungeon' | 'pvp';
export const ACTIVITY_KINDS: readonly ActivityKind[] = ['raid', 'dungeon', 'pvp'];

/** Сколько мест по ролям в основе (null — без лимита). Бойцы — ближний и дальний бой вместе. */
export interface RoleLimits {
  tank: number | null;
  healer: number | null;
  dps: number | null;
}
export type LimitGroup = keyof RoleLimits;

export const NO_LIMITS: RoleLimits = { tank: null, healer: null, dps: null };

/**
 * title — в начале фразы («Подземелье **X** начнётся»), word — внутри («напоминание: подземелье **X**»),
 * to / from — «запись на рейд / в подземелье», «отписка от рейда / из подземелья».
 * Глаголы рядом — без рода: «отменили», «перенесли», «начнётся».
 */
export const KINDS: Record<ActivityKind, { title: string; word: string; to: string; from: string; size: number; limits: RoleLimits }> = {
  raid: { title: 'Рейд', word: 'рейд', to: 'на рейд', from: 'от рейда', size: 25, limits: NO_LIMITS },
  dungeon: { title: 'Подземелье', word: 'подземелье', to: 'в подземелье', from: 'из подземелья', size: 5, limits: { tank: 1, healer: 1, dps: 3 } },
  pvp: { title: 'PvP', word: 'PvP', to: 'в PvP-группу', from: 'из PvP-группы', size: 10, limits: NO_LIMITS },
};

/** Группы для лимитов: [ключ, «1 танк», «2 танка», «5 танков», заголовок]. */
export const LIMIT_GROUPS: readonly { group: LimitGroup; forms: [string, string, string]; title: string }[] = [
  { group: 'tank', forms: ['танк', 'танка', 'танков'], title: 'Танки' },
  { group: 'healer', forms: ['лекарь', 'лекаря', 'лекарей'], title: 'Лекари' },
  { group: 'dps', forms: ['боец', 'бойца', 'бойцов'], title: 'Бойцы' },
];

export function limitGroup(role: RaidRole): LimitGroup {
  return role === 'tank' || role === 'healer' ? role : 'dps';
}

export const isKind = (value: unknown): value is ActivityKind => ACTIVITY_KINDS.includes(value as ActivityKind);

export const hasLimits = (limits: RoleLimits): boolean => LIMIT_GROUPS.some(({ group }) => limits[group] !== null);

/** Лимиты из JSON (база, настройки): всё неверное — «без лимита». */
export function parseLimits(value: unknown): RoleLimits {
  const source = typeof value === 'string' ? safeJson(value) : value;
  const limits = { ...NO_LIMITS };
  if (!source || typeof source !== 'object') return limits;
  for (const { group } of LIMIT_GROUPS) {
    const n = (source as Record<string, unknown>)[group];
    limits[group] = typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : null;
  }
  return limits;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
