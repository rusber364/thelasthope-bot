import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mock, test } from 'node:test';
import { Events } from 'discord.js';

process.env.BOT_DB_PATH = ':memory:';
const { nextRepostDelay, refreshStickies, registerSticky } = await import('./sticky.ts');
const { getSettings, saveSettings } = await import('../botSettings.ts');

test('задержка: пауза тишины и не чаще интервала', () => {
  assert.equal(nextRepostDelay(100_000, 0, 15_000), 3_000);
  assert.equal(nextRepostDelay(100_000, 95_000, 15_000), 10_000);
  assert.equal(nextRepostDelay(100_000, 99_000, 15_000), 14_000);
});

// Подставной канал «S»: запоминает отправленные и удалённые сообщения.
const posted: string[] = [];
const deleted: string[] = [];
let lastId = 0;
const channel = {
  id: 'S',
  lastMessageId: null as string | null,
  isSendable: () => true,
  send: async (payload: { content: string }) => {
    posted.push(payload.content);
    channel.lastMessageId = `m${++lastId}`;
    return { id: channel.lastMessageId };
  },
  messages: { delete: async (id: string) => void deleted.push(id) },
};
const message = (authorId: string, content: string) => ({
  inGuild: () => true,
  channelId: 'S',
  channel,
  content,
  author: { id: authorId },
  client: { user: { id: 'bot' } },
});
const flush = () => new Promise((resolve) => setImmediate(resolve));

const s = structuredClone(getSettings());
s.sticky = { intervalSeconds: 15, items: [{ channelId: 'S', text: 'Правила рег: записывайтесь до 19:00' }] };
saveSettings(s);

test('пачка сообщений — одна перестановка, своя копия не считается, не чаще раза в 15 секунд', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  try {
    const client = new EventEmitter();
    registerSticky(client as never);

    for (let i = 0; i < 5; i++) client.emit(Events.MessageCreate, message('u1', `сообщение ${i}`));
    mock.timers.tick(3_000);
    await flush();
    assert.equal(posted.length, 1, 'одна перестановка на пачку');
    assert.match(posted[0]!, /Правила рег/);
    assert.match(posted[0]!, /📌 закреплено$/);

    // Собственная копия закрепа приходит как новое сообщение — её игнорируем.
    client.emit(Events.MessageCreate, message('bot', posted[0]!));
    mock.timers.tick(20_000);
    await flush();
    assert.equal(posted.length, 1);

    // Новое сообщение через секунду после перестановки — ждём до 15 секунд с прошлой.
    mock.timers.setTime(1_004_000);
    client.emit(Events.MessageCreate, message('u2', 'ещё'));
    mock.timers.tick(13_000);
    await flush();
    assert.equal(posted.length, 1, 'ещё рано');
    mock.timers.tick(1_000);
    await flush();
    assert.equal(posted.length, 2);
    assert.deepEqual(deleted, ['m1'], 'прошлая копия удалена');
  } finally {
    mock.timers.reset();
  }
});

test('запуск: закреп последний — не трогаем; убранный из настроек канал — удаляем копию', async () => {
  const guild = { channels: { cache: new Map([['S', channel]]) } };
  const before = posted.length;
  await refreshStickies(guild as never);
  assert.equal(posted.length, before, 'закреп и так последний');

  channel.lastMessageId = 'чужое';
  await refreshStickies(guild as never);
  assert.equal(posted.length, before + 1, 'после чужих сообщений закреп переставлен');

  const off = structuredClone(getSettings());
  off.sticky.items = [];
  saveSettings(off);
  const lastSticky = channel.lastMessageId;
  await refreshStickies(guild as never);
  assert.ok(deleted.includes(lastSticky!), 'копия удалена из канала, где закрепа больше нет');
});
