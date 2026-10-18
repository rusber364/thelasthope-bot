// Виды сборов — как у бота (src/raids/kinds.ts): название, размер и лимиты по ролям по умолчанию.
import type { ActivityKind, RoleLimits } from '@api';

export const NO_LIMITS: RoleLimits = { tank: null, healer: null, dps: null };

export const KINDS: Record<ActivityKind, { title: string; size: number; limits: RoleLimits }> = {
  raid: { title: 'Рейд', size: 25, limits: NO_LIMITS },
  dungeon: { title: 'Подземелье', size: 5, limits: { tank: 1, healer: 1, dps: 3 } },
  pvp: { title: 'PvP', size: 10, limits: NO_LIMITS },
};

export const KIND_ITEMS = Object.fromEntries(Object.entries(KINDS).map(([kind, { title }]) => [kind, title])) as Record<
  ActivityKind,
  string
>;

export const LIMIT_FIELDS: { group: keyof RoleLimits; title: string }[] = [
  { group: 'tank', title: 'Танки' },
  { group: 'healer', title: 'Лекари' },
  { group: 'dps', title: 'Бойцы' },
];
