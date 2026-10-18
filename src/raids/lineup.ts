// Кто в основе, кто в запасе, кто «под вопросом» — один расчёт для реги, итога, сбора и посещаемости.
// И кто вообще может записаться: роли из шаблона рейда.
import type { Raid, Signup } from './store.ts';

export interface Lineup {
  main: Signup[];
  bench: Signup[];
  tentative: Signup[];
}

/** Основа — первые size записавшихся без «под вопросом» и без отметки «только в запас»; остальные — запас. */
export function lineup(signups: Signup[], size: number): Lineup {
  const confirmed = signups.filter((signup) => !signup.tentative);
  const regular = confirmed.filter((signup) => !signup.reserve);
  return {
    main: regular.slice(0, size),
    bench: [...regular.slice(size), ...confirmed.filter((signup) => signup.reserve)],
    tentative: signups.filter((signup) => signup.tentative),
  };
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
