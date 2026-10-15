import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.BOT_DB_PATH = ':memory:';
const { raidHandler } = await import('./handlers.ts');
const { createRaid } = await import('./store.ts');
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
const member = { id: 'u1', displayName: 'Морозко', toString: () => '<@u1>' };
const client = { channels: { fetch: async () => null } };
const raid = createRaid({ guildId: 'g', channelId: 'c', title: 'Огненные Недра', startsAt: Date.now() + 86_400_000, size: 40, createdBy: 'u' });

function interaction(kind: 'select' | 'button', values: string[] = []) {
  return {
    user: { id: 'u1' },
    member,
    guild,
    client,
    values,
    isStringSelectMenu: () => kind === 'select',
    isButton: () => kind === 'button',
    isModalSubmit: () => false,
    update: async () => {},
    reply: async () => {},
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
