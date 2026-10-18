// Кто в основе, кто в запасе, кто «под вопросом» — один расчёт для реги, итога, сбора и посещаемости.
// И кто вообще может записаться: роли из шаблона рейда.
import { specById } from './classes.ts';
import { LIMIT_GROUPS, NO_LIMITS, limitGroup, type LimitGroup, type RoleLimits } from './kinds.ts';
import type { Raid, Signup } from './store.ts';

export interface Lineup {
  main: Signup[];
  bench: Signup[];
  tentative: Signup[];
}

/**
 * Основа — записавшиеся по порядку, пока есть общие места и места по роли (лимиты танков, лекарей, бойцов);
 * остальные — в запас (сначала не поместившиеся, потом «только в запас»). «Под вопросом» — отдельно.
 * Состав считается заново при каждой перерисовке, поэтому освободившееся место занимает первый подходящий из запаса.
 */
export function lineup(signups: Signup[], size: number, limits: RoleLimits = NO_LIMITS): Lineup {
  const main: Signup[] = [];
  const overflow: Signup[] = [];
  const reserve: Signup[] = [];
  const taken: Record<LimitGroup, number> = { tank: 0, healer: 0, dps: 0 };
  for (const signup of signups) {
    if (signup.tentative) continue;
    if (signup.reserve) {
      reserve.push(signup);
      continue;
    }
    const group = groupOf(signup);
    const limit = limits[group];
    if (main.length < size && (limit === null || taken[group] < limit)) {
      main.push(signup);
      taken[group] += 1;
    } else {
      overflow.push(signup);
    }
  }
  return { main, bench: [...overflow, ...reserve], tentative: signups.filter((signup) => signup.tentative) };
}

/** Группа лимита по спеку записи: танк, лекарь или боец. */
export const groupOf = (signup: Pick<Signup, 'specId'>): LimitGroup => limitGroup(specById.get(signup.specId)?.role ?? 'melee');

/** Сколько в основе танков, лекарей и бойцов. */
export function takenByGroup(main: Signup[]): Record<LimitGroup, number> {
  const taken: Record<LimitGroup, number> = { tank: 0, healer: 0, dps: 0 };
  for (const signup of main) taken[groupOf(signup)] += 1;
  return taken;
}

/** Любой спек этой группы — чтобы примерить роль. */
const SAMPLE_SPEC = Object.fromEntries(
  LIMIT_GROUPS.map(({ group }) => [group, [...specById.values()].find((spec) => limitGroup(spec.role) === group)!.id]),
) as Record<LimitGroup, string>;

/**
 * Роли, с которыми участник попал бы в запас из-за лимита: примеряем каждую роль на его место в очереди
 * (если уже записан — на его номер, если нет — в конец). Для меню спеков: «мест нет — в запас».
 */
export function fullGroups(signups: Signup[], size: number, limits: RoleLimits, userId: string): Set<LimitGroup> {
  const full = new Set<LimitGroup>();
  const mine = signups.find((s) => s.userId === userId);
  for (const { group } of LIMIT_GROUPS) {
    const limit = limits[group];
    if (limit === null) continue;
    const specId = SAMPLE_SPEC[group];
    const trial = mine
      ? signups.map((s) => (s.userId === userId ? { ...s, specId, tentative: false, reserve: false } : s))
      : [...signups, { raidId: 0, userId, specId, displayName: null, tentative: false, reserve: false, createdAt: Number.MAX_SAFE_INTEGER }];
    const { main } = lineup(trial, size, limits);
    if (!main.some((s) => s.userId === userId) && takenByGroup(main)[group] >= limit) full.add(group);
  }
  return full;
}

/** Куда можно записаться: в основу, только в запас или никуда — рега для других ролей. */
export type SignupAccess = 'main' | 'reserve' | null;

export function signupAccess(memberRoleIds: ReadonlySet<string>, raid: Pick<Raid, 'mainRoleIds' | 'reserveRoleIds'>): SignupAccess {
  if (!raid.mainRoleIds.length) return 'main';
  if (raid.mainRoleIds.some((id) => memberRoleIds.has(id))) return 'main';
  if (raid.reserveRoleIds.some((id) => memberRoleIds.has(id))) return 'reserve';
  return null;
}

/** «<@&1>, <@&2>» — роли строкой (в embed и скрытых ответах упоминания не пингуют). */
export const roleMentions = (ids: string[]): string => ids.map((id) => `<@&${id}>`).join(', ');
