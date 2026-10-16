import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

process.env.BOT_DB_PATH = ':memory:';
const { buildBoard, refreshBoard, requestBoardRefresh } = await import('./board.ts');
const { createRaid, setRaidMessage, setRaidStatus, upsertSignup, setTentative } = await import('./store.ts');
const { getSettings, saveSettings } = await import('../botSettings.ts');

const HOUR = 3_600_000;
const raid = (title: string, inHours: number) => {
  const created = createRaid({ guildId: 'g', channelId: 'A', title, startsAt: Date.now() + inHours * HOUR, size: 40, createdBy: 'o' });
  setRaidMessage(created.id, `m-${created.id}`);
  return created;
};

test('список: пусто — так и пишем; иначе название-ссылка, время, записавшиеся и «под вопросом»', () => {
  assert.match(buildBoard([]).data.description!, /Открытых рег пока нет/);
  const r = { id: 7, guildId: 'g', channelId: 'A', messageId: 'm7', title: 'Огненные Недра', description: null, startsAt: 0, size: 40, createdBy: 'o', leaderName: null, status: 'open' as const };
  const text = buildBoard([{ raid: r, signed: 12, tentative: 2 }]).data.description!;
  assert.match(text, /\[Огненные Недра\]\(https:\/\/discord\.com\/channels\/g\/A\/m7\)/);
  assert.match(text, /12\/40/);
  assert.match(text, /❔ 2/);
  assert.match(text, /<#A>/);
});

// Подставной сервер с двумя каналами: запоминаем отправленное, правки и удаления.
const log: string[] = [];
let editFails = false;
const channel = (id: string) => ({
  isTextBased: () => true,
  send: async (payload: { embeds: { data: { description?: string } }[] }) => {
    log.push(`send ${id}: ${payload.embeds[0]!.data.description}`);
    return { id: `${id}-msg${log.length}` };
  },
  messages: {
    edit: async (messageId: string, payload: { embeds: { data: { description?: string } }[] }) => {
      if (editFails) throw new Error('Unknown Message');
      log.push(`edit ${messageId}: ${payload.embeds[0]!.data.description}`);
    },
    delete: async (messageId: string) => void log.push(`delete ${messageId}`),
  },
});
const client = { guilds: { cache: new Map([['g', { channels: { cache: new Map([['A', channel('A')], ['B', channel('B')]]) } }]]) } };
const setBoardChannel = (id: string | null) => {
  const s = structuredClone(getSettings());
  s.raids.boardChannelId = id;
  saveSettings(s);
};

test('список ведётся одним сообщением: создать, обновить, перенести, убрать', async () => {
  await refreshBoard(client as never, 'g');
  assert.equal(log.length, 0, 'без канала ничего не публикуем');

  const later = raid('Логово Ониксии', 30);
  const sooner = raid('Огненные Недра', 3);
  upsertSignup(sooner.id, 'u1', 'mage-fire', 'Морозко');
  upsertSignup(sooner.id, 'u2', 'priest-holy', 'Ласточка');
  setTentative(sooner.id, 'u2', true);

  setBoardChannel('A');
  await refreshBoard(client as never, 'g');
  assert.equal(log.length, 1);
  assert.match(log[0]!, /^send A:/);
  assert.ok(log[0]!.indexOf('Огненные Недра') < log[0]!.indexOf('Логово Ониксии'), 'ближайшие — первыми');
  assert.match(log[0]!, /1\/40 · ❔ 1/);

  setRaidStatus(later.id, 'cancelled');
  await refreshBoard(client as never, 'g');
  assert.match(log[1]!, /^edit A-msg1:/, 'то же сообщение обновлено');
  assert.doesNotMatch(log[1]!, /Логово Ониксии/, 'отменённой реги в списке нет');

  editFails = true; // сообщение удалили руками
  await refreshBoard(client as never, 'g');
  editFails = false;
  assert.match(log[2]!, /^send A:/);

  setBoardChannel('B');
  await refreshBoard(client as never, 'g');
  assert.deepEqual(log.slice(3, 5).map((line) => line.split(':')[0]), ['delete A-msg3', 'send B']);

  setBoardChannel(null);
  await refreshBoard(client as never, 'g');
  assert.equal(log.at(-1), 'delete B-msg5');
});

test('много изменений подряд — одно обновление списка', async () => {
  setBoardChannel('A');
  await refreshBoard(client as never, 'g');
  const before = log.length;
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    for (let i = 0; i < 5; i++) requestBoardRefresh(client as never, 'g');
    mock.timers.tick(1500);
  } finally {
    mock.timers.reset();
  }
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(log.length, before + 1);
});
