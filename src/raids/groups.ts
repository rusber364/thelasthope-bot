// Группы, которые игроки открывают сами (/group): кто может открыть, кто может управлять, лимит из параметра команды.
import type { PlayerGroupSettings } from '../botSettings.ts';
import { roleMentions } from './lineup.ts';
import type { Raid } from './store.ts';

/** Почему участник не может открыть группу этого вида (null — может). */
export function createProblem(group: PlayerGroupSettings, kindTitle: string, memberRoleIds: ReadonlySet<string>): string | null {
  if (!group.channelId) {
    return `Группы «${kindTitle}» пока не настроены: попроси офицеров выбрать для них канал в админке («Настройки рег» → «Группы от игроков»).`;
  }
  if (group.creatorRoleIds.length && !group.creatorRoleIds.some((id) => memberRoleIds.has(id))) {
    return `Открывать группы «${kindTitle}» могут роли: ${roleMentions(group.creatorRoleIds)}.`;
  }
  return null;
}

/** Свою группу меняет тот, кто её открыл; любую регу (и рейды) — тот, у кого право «Управлять событиями». */
export function canManage(raid: Pick<Raid, 'player' | 'createdBy'>, userId: string, isOfficer: boolean): boolean {
  return isOfficer || (raid.player && raid.createdBy === userId);
}

export type LimitChange = { change: false } | { change: true; value: number | null } | { error: string };

/** Лимит из параметра команды: число — столько мест, «нет» — без лимита, не указан — не менять. */
export function parseLimit(text: string | null, title: string): LimitChange {
  if (text === null) return { change: false };
  const value = text.trim().toLowerCase();
  if (['нет', '-', '—', 'без', 'без лимита'].includes(value)) return { change: true, value: null };
  const n = Number(value);
  if (!/^\d+$/.test(value) || n > 100) return { error: `«${title}»: напиши число от 0 до 100 или «нет» — без лимита.` };
  return { change: true, value: n };
}
