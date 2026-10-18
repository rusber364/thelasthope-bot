import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.BOT_DB_PATH = ':memory:';
const { raidHandler } = await import('./handlers.ts');
const { createRaid, getSignup, getSignups } = await import('./store.ts');
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
function interaction(kind: 'select' | 'button', values: string[] = []) {
  const answer = async (payload: { content?: string }) => void answers.push(payload.content ?? '');
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

  await raidHandler.handle(interaction('select', ['mage']), ['class', id]);
  assert.match(last(), /Эта рега для ролей: <@&RAIDER>, <@&GUEST>/);
  await raidHandler.handle(interaction('select', ['mage_fire']), ['spec', id]);
  assert.match(last(), /Эта рега для ролей/, 'меню спеков, открытое раньше, тоже не записывает');
  assert.equal(getSignup(restricted.id, 'u1'), null);

  memberRoles.set('GUEST', {});
  await raidHandler.handle(interaction('select', ['mage']), ['class', id]);
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
