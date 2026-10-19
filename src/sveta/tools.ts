// Что Света знает о гильдии: сводка ближайших сборов (лежит в каждом запросе — «когда рейд?» обходится одним запросом)
// и инструменты для подробностей. Инструменты только читают базу бота; что именно отдавать, решает код, а не модель.
import { getSettings } from '../botSettings.ts';
import { ROLES, ROLE_ORDER, classById, specById } from '../raids/classes.ts';
import { KINDS, isKind } from '../raids/kinds.ts';
import { lineup } from '../raids/lineup.ts';
import { getRaid, getSignups, upcomingRaids, type Raid, type Signup } from '../raids/store.ts';
import { settings as constants } from '../settings.ts';
import type { GeminiFunction } from './gemini.ts';

const DAY = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const whenFormat = new Intl.DateTimeFormat('ru-RU', {
  timeZone: constants.timeZone,
  weekday: 'short',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

/** «чт, 23 октября в 20:00» — по Киеву. */
export const raidWhen = (ms: number) => whenFormat.format(ms);

export const raidLink = (raid: Raid): string | null =>
  raid.messageId ? `https://discord.com/channels/${raid.guildId}/${raid.channelId}/${raid.messageId}` : null;

/** Коротко о реге: номер, вид, когда, сколько записано, ссылка. */
function brief(raid: Raid) {
  const { main, bench, tentative } = lineup(getSignups(raid.id), raid.size, raid.limits);
  return {
    id: raid.id,
    kind: KINDS[raid.kind].title,
    title: raid.title,
    when: raidWhen(raid.startsAt),
    main: `${main.length} из ${raid.size}`,
    bench: bench.length,
    tentative: tentative.length,
    link: raidLink(raid),
  };
}

/** Сводка для системной инструкции: до трёх ближайших открытых рег. */
export function guildSummary(guildId: string, limit = 3): string {
  const raids = upcomingRaids(guildId, limit);
  if (!raids.length) return 'Открытых рег сейчас нет.';
  return raids
    .map((raid) => {
      const b = brief(raid);
      const extra = [b.bench ? `в запасе ${b.bench}` : '', b.tentative ? `под вопросом ${b.tentative}` : ''].filter(Boolean).join(', ');
      return `- #${b.id} ${b.kind} «${b.title}» — ${b.when}, в основе ${b.main}${extra ? `, ${extra}` : ''}${b.link ? `, рега: ${b.link}` : ''}`;
    })
    .join('\n');
}

/** Инструменты для Gemini (имена — латиницей, так требует API; описания модель читает по-русски). */
export const TOOLS: GeminiFunction[] = [
  {
    name: 'upcoming_raids',
    description: 'Ближайшие открытые реги гильдии (рейды, подземелья, PvP): номер, вид, название, когда, сколько записано, ссылка.',
    parameters: {
      type: 'OBJECT',
      properties: { kind: { type: 'STRING', enum: ['raid', 'dungeon', 'pvp'], description: 'Только этот вид сбора (необязательно).' } },
    },
  },
  {
    name: 'raid_roster',
    description: 'Кто записан на регу: основа по ролям (танки, ближний бой, дальний бой, лекари) с классом и спеком, запас и «под вопросом».',
    parameters: {
      type: 'OBJECT',
      properties: { raid_id: { type: 'INTEGER', description: 'Номер реги — число после «#» в сводке или в списке рег.' } },
      required: ['raid_id'],
    },
  },
  {
    name: 'raid_schedule',
    description: 'Расписание гильдии: какие сборы по каким дням и во сколько (по Киеву) и когда открывается рега.',
  },
];

const who = (signup: Signup) => {
  const spec = specById.get(signup.specId);
  const name = signup.displayName ?? 'участник';
  return spec ? `${name} (${classById.get(spec.classId)?.name ?? ''} — ${spec.name})` : name;
};

/** Выполнить инструмент. Результат уходит модели как есть — только данные этого сервера. */
export function runTool(name: string, args: Record<string, unknown>, guildId: string): unknown {
  if (name === 'upcoming_raids') {
    const kind = isKind(args.kind) ? args.kind : null;
    const raids = upcomingRaids(guildId, 25)
      .filter((raid) => !kind || raid.kind === kind)
      .slice(0, 10)
      .map(brief);
    return raids.length ? { raids } : { raids: [], note: 'Открытых рег нет.' };
  }
  if (name === 'raid_roster') {
    const raid = getRaid(Number(args.raid_id));
    if (!raid || raid.guildId !== guildId) return { error: 'Нет такой реги.' };
    const { main, bench, tentative } = lineup(getSignups(raid.id), raid.size, raid.limits);
    const roles = Object.fromEntries(
      ROLE_ORDER.map((role) => [ROLES[role].title, main.filter((signup) => specById.get(signup.specId)?.role === role).map(who)]),
    );
    const status = { open: 'запись открыта', closed: 'запись закрыта', cancelled: 'отменили' }[raid.status];
    return { ...brief(raid), status, main: roles, bench: bench.map(who), tentative: tentative.map(who) };
  }
  if (name === 'raid_schedule') {
    const templates = getSettings()
      .raidTemplates.filter((template) => template.channelId && template.slots.length)
      .map((template) => ({
        title: template.title,
        kind: KINDS[template.kind].title,
        times: template.slots.map((slot) => `${DAY[slot.raidDay]} ${slot.raidTime}, рега открывается: ${DAY[slot.openDay]} ${slot.openTime}`),
      }));
    return templates.length ? { templates } : { templates: [], note: 'Расписания нет — реги открывают офицеры вручную.' };
  }
  return { error: `Нет такого инструмента: ${name}.` };
}
