import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { Collection, Events, SnowflakeUtil } from 'discord.js';

process.env.BOT_DB_PATH = ':memory:';
const { BULK_MAX_AGE_MS, MAX_SINGLE_DELETES, cleanChannel, isCleanable } = await import('./autoClean.ts');
const { registerMessageLogs } = await import('../logs/messages.ts');
const { getSettings, saveSettings } = await import('../botSettings.ts');

const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;
const rule = { channelId: 'C', hours: 24, keepBot: true };
const msg = (hoursAgo: number, extra: { pinned?: boolean; author?: string } = {}) => {
  const createdTimestamp = NOW - hoursAgo * HOUR;
  return { id: SnowflakeUtil.generate({ timestamp: createdTimestamp }).toString(), createdTimestamp, pinned: extra.pinned ?? false, author: { id: extra.author ?? 'u1' } };
};

test('что удаляем: старше срока, не закреплённое, не сообщение бота (если так настроено)', () => {
  assert.equal(isCleanable(msg(25), rule, NOW, 'bot'), true);
  assert.equal(isCleanable(msg(23), rule, NOW, 'bot'), false, 'ещё молодое');
  assert.equal(isCleanable(msg(25, { pinned: true }), rule, NOW, 'bot'), false, 'закреплённое');
  assert.equal(isCleanable(msg(25, { author: 'bot' }), rule, NOW, 'bot'), false, 'сообщение бота');
  assert.equal(isCleanable(msg(25, { author: 'bot' }), { ...rule, keepBot: false }, NOW, 'bot'), true);
});

/** Канал с историей: отдаёт сообщения старше before (новые первыми), запоминает удаления. */
function channelWith(history: ReturnType<typeof msg>[]) {
  const sorted = [...history].sort((a, b) => b.createdTimestamp - a.createdTimestamp);
  const bulk: string[][] = [];
  const single: string[] = [];
  return {
    bulk,
    single,
    channel: {
      id: 'C',
      messages: {
        fetch: async ({ limit, before }: { limit: number; before: string }) =>
          new Map(sorted.filter((m) => BigInt(m.id) < BigInt(before)).slice(0, limit).map((m) => [m.id, m])),
        delete: async (id: string) => void single.push(id),
      },
      bulkDelete: async (ids: string[]) => void bulk.push(ids),
    },
  };
}

test('молодые (до 14 дней) — пачками по 100, старые — по одному и не больше лимита за проход', async () => {
  const fresh = Array.from({ length: 150 }, (_, i) => msg(25 + i * 0.01));
  const ancient = Array.from({ length: 40 }, (_, i) => msg(BULK_MAX_AGE_MS / HOUR + 10 + i));
  const keep = [msg(1), msg(30, { pinned: true }), msg(30, { author: 'bot' })];
  const { channel, bulk, single } = channelWith([...fresh, ...ancient, ...keep]);

  const deleted = await cleanChannel(channel, rule, NOW, 'bot');
  assert.deepEqual(bulk.map((ids) => ids.length), [100, 50]);
  assert.equal(single.length, MAX_SINGLE_DELETES, 'старше 14 дней — по одному, понемногу');
  assert.equal(deleted, 150 + MAX_SINGLE_DELETES);
  const removed = new Set([...bulk.flat(), ...single]);
  for (const m of keep) assert.equal(removed.has(m.id), false);
});

test('удалённое автоочисткой не засоряет «лог-сообщения»', async () => {
  const logged: string[] = [];
  const logChannel = { isSendable: () => true, send: async (p: { embeds: { data: { title?: string } }[] }) => void logged.push(p.embeds[0]!.data.title ?? '') };
  const s = structuredClone(getSettings());
  s.logs.messages = { channelId: 'L', enabled: true };
  saveSettings(s);
  const guild = { channels: { cache: new Map([['L', logChannel]]) } };

  const old = [msg(30), msg(31)];
  const { channel } = channelWith(old);
  await cleanChannel(channel, rule, NOW, 'bot'); // помечает удалённые

  const client = new EventEmitter();
  registerMessageLogs(client as never);
  client.emit(Events.MessageBulkDelete, new Collection(old.map((m) => [m.id, { id: m.id, partial: true }])), { id: 'C', guild });
  // Обычное массовое удаление (не ботом) по-прежнему пишется.
  client.emit(Events.MessageBulkDelete, new Collection([['x', { id: 'x', partial: true }]]), { id: 'C', guild, toString: () => '<#C>' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(logged, ['Массовое удаление сообщений']);
});
