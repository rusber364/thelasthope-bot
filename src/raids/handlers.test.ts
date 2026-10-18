import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.BOT_DB_PATH = ':memory:';
const { raidHandler, specMenuOptions } = await import('./handlers.ts');
const { createRaid, getSignup, getSignups, upsertSignup } = await import('./store.ts');
const { lineup } = await import('./lineup.ts');
const { getSettings, saveSettings } = await import('../botSettings.ts');

// Лог-канал рег — подставной: запоминает отправленные embed'ы.
const sent: { title?: string; description?: string }[] = [];
const logChannel = { isSendable: () => true, send: async (payload: { embeds: { toJSON(): { title?: string; description?: string } }[] }) => {
  sent.push(...payload.embeds.map((e) => e.toJSON()));
} };
const settings = structuredClone(getSettings());
settings.logs.raids = { channelId: 'L', enabled: true };
saveSettings(settings);

const guild = { id: 'g', channels: { cache: new Map([['L', logChannel]]) } };
const memberRoles = new Map<string, unknown>();
const member = { id: 'u1', displayName: 'Морозко', toString: () => '<@u1>', roles: { cache: memberRoles } };
const client = { channels: { fetch: async () => null } };
const raid = createRaid({ guildId: 'g', channelId: 'c', title: 'Огненные Недра', startsAt: Date.now() + 86_400_000, size: 40, createdBy: 'u' });

/** Что бот ответил участнику (скрытые ответы и обновления меню). */
const answers: string[] = [];
/** Пункты меню в последнем ответе (меню спеков после кнопки роли). */
let lastOptions: { label: string; value: string }[] = [];
type Payload = { content?: string; components?: { toJSON(): { components: { options?: { label: string; value: string }[] }[] } }[] };
function interaction(kind: 'select' | 'button', values: string[] = []) {
  const answer = async (payload: Payload) => {
    answers.push(payload.content ?? '');
    lastOptions = payload.components?.flatMap((row) => row.toJSON().components.flatMap((c) => c.options ?? [])) ?? [];
  };
  return {
    user: { id: 'u1' },
    member,
    guild,
    client,
    values,
    isStringSelectMenu: () => kind === 'select',
    isButton: () => kind === 'button',
    isModalSubmit: () => false,
    update: answer,
    reply: answer,
  } as never;
}

const titles = () => sent.map((e) => e.title);

test('каждое действие с регой попадает в лог-рейдов один раз', async () => {
  await raidHandler.handle(interaction('select', ['mage_fire']), ['spec', String(raid.id)]);
  assert.deepEqual(titles(), ['Запись на рейд']);
  assert.match(sent[0]!.description ?? '', /Огненные Недра/);
  assert.match(sent[0]!.description ?? '', /Маг — Огонь/);

  // Тот же спек ещё раз — без новой записи в лог.
  await raidHandler.handle(interaction('select', ['mage_fire']), ['spec', String(raid.id)]);
  assert.equal(sent.length, 1);

  await raidHandler.handle(interaction('select', ['mage_frost']), ['spec', String(raid.id)]);
  await raidHandler.handle(interaction('button'), ['maybe', String(raid.id)]);
  await raidHandler.handle(interaction('button'), ['maybe', String(raid.id)]);
  await raidHandler.handle(interaction('button'), ['leave', String(raid.id)]);
  assert.deepEqual(titles(), ['Запись на рейд', 'Смена специализации', 'Отметка «под вопросом»', 'Снова в основном списке', 'Отписка от рейда']);
});

test('выключенный лог ничего не пишет', async () => {
  const off = structuredClone(getSettings());
  off.logs.raids.enabled = false;
  saveSettings(off);
  const before = sent.length;
  await raidHandler.handle(interaction('select', ['warrior_prot']), ['spec', String(raid.id)]);
  assert.equal(sent.length, before);
});

test('кто может записаться: без роли — отказ, роль основы — в основу, гость — только в запас даже при свободных местах', async () => {
  const restricted = createRaid({
    guildId: 'g',
    channelId: 'c',
    title: 'Основной статик',
    startsAt: Date.now() + 86_400_000,
    size: 2,
    createdBy: 'u',
    mainRoleIds: ['RAIDER'],
    reserveRoleIds: ['GUEST'],
  });
  const id = String(restricted.id);
  const last = () => answers.at(-1) ?? '';
  memberRoles.clear();

  await raidHandler.handle(interaction('button'), ['role', id, 'ranged']);
  assert.match(last(), /Эта рега для ролей: <@&RAIDER>, <@&GUEST>/);
  await raidHandler.handle(interaction('select', ['mage_fire']), ['spec', id]);
  assert.match(last(), /Эта рега для ролей/, 'меню спеков, открытое раньше, тоже не записывает');
  assert.equal(getSignup(restricted.id, 'u1'), null);

  memberRoles.set('GUEST', {});
  await raidHandler.handle(interaction('button'), ['role', id, 'ranged']);
  assert.match(last(), /только в запас/);
  await raidHandler.handle(interaction('select', ['mage_fire']), ['spec', id]);
  assert.equal(getSignup(restricted.id, 'u1')?.reserve, true);
  assert.match(last(), /Ты в запасе: в основной состав этой реги записываются <@&RAIDER>/);
  assert.deepEqual(lineup(getSignups(restricted.id), restricted.size).main, [], 'место в основе свободно, но гость — в запасе');

  // Стал рейдером — при смене спека переходит в основу.
  memberRoles.set('RAIDER', {});
  await raidHandler.handle(interaction('select', ['mage_frost']), ['spec', id]);
  assert.equal(getSignup(restricted.id, 'u1')?.reserve, false);
  assert.doesNotMatch(last(), /в запасе/);
});

test('кнопка роли показывает спеки этой роли у всех классов', async () => {
  memberRoles.clear();
  await raidHandler.handle(interaction('button'), ['role', String(raid.id), 'tank']);
  assert.match(answers.at(-1) ?? '', /\*\*Танк\*\* — выбери класс и специализацию/);
  assert.deepEqual(
    lastOptions.map((o) => o.label),
    ['Воин — Защита', 'Паладин — Защита', 'Друид — Сила зверя (медведь)'],
  );

  // В каждом меню — только своя роль, и все спеки помещаются (у Discord до 25 пунктов).
  const all = (['tank', 'melee', 'ranged', 'healer'] as const).flatMap((role) => specMenuOptions(role).map((o) => o.value));
  assert.equal(new Set(all).size, all.length, 'спек не попадает в две роли');
  for (const role of ['tank', 'melee', 'ranged', 'healer'] as const) assert.ok(specMenuOptions(role).length <= 25);
  assert.ok(specMenuOptions('ranged').some((o) => o.value === 'priest_shadow'));
  assert.ok(specMenuOptions('healer').some((o) => o.value === 'druid_resto'));

  // Незнакомая роль в customId — ничего не делаем.
  const before = answers.length;
  await raidHandler.handle(interaction('button'), ['role', String(raid.id), 'bard']);
  assert.equal(answers.length, before);
});

test('роль набрана по лимиту — предупреждаем ещё до выбора спека', async () => {
  const dungeon = createRaid({
    guildId: 'g',
    channelId: 'c',
    title: 'Мёртвые копи',
    startsAt: Date.now() + 86_400_000,
    size: 5,
    createdBy: 'u',
    kind: 'dungeon',
    limits: { tank: 1, healer: 1, dps: 3 },
  });
  upsertSignup(dungeon.id, 'u2', 'warrior_prot', 'Танкист');
  memberRoles.clear();

  await raidHandler.handle(interaction('button'), ['role', String(dungeon.id), 'tank']);
  assert.match(answers.at(-1) ?? '', /Танки уже набраны \(1\) — запишу в запас/);
  await raidHandler.handle(interaction('button'), ['role', String(dungeon.id), 'healer']);
  assert.doesNotMatch(answers.at(-1) ?? '', /набраны/);
});

test('меню классов со старого сообщения реги просит нажать кнопку роли', async () => {
  await raidHandler.handle(interaction('select', ['mage']), ['class', String(raid.id)]);
  assert.match(answers.at(-1) ?? '', /кнопками ролей/);
});
