import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { ChannelType } from 'discord.js';

process.env.BOT_DB_PATH = ':memory:';
const { tempchannel } = await import('../commands/general/tempchannel.ts');
const { expireTempChannels, tempChannelExpiry } = await import('./tempChannels.ts');

const HOUR = 3_600_000;

// Подставной сервер: создаёт каналы, запоминает удаления.
const deleted: string[] = [];
const channels = new Map<string, { id: string; name: string; type: ChannelType; members: Map<string, unknown>; delete(): Promise<void> }>();
let created: Record<string, unknown> | null = null;
let nextId = 0;
const guild = {
  id: 'g',
  channels: {
    cache: channels,
    create: async (options: { name: string; type: ChannelType }) => {
      created = options;
      const id = `ch${++nextId}`;
      const channel = {
        id,
        name: options.name,
        type: options.type,
        members: new Map<string, unknown>(),
        send: async () => {},
        toString: () => `<#${id}>`,
        delete: async () => {
          deleted.push(channel.id);
          channels.delete(channel.id);
        },
      };
      channels.set(channel.id, channel);
      return channel;
    },
  },
};
const client = { guilds: { cache: new Map([['g', guild]]) } };
const replies: string[] = [];
const run = (options: { name: string; hours: number; type?: string }, canManage = true) =>
  tempchannel.execute({
    guild,
    user: { id: 'o', tag: 'Офицер#0001' },
    channel: { parent: { id: 'cat' } },
    appPermissions: { has: () => canManage },
    options: {
      getString: (key: string) => (key === 'name' ? options.name : key === 'type' ? (options.type ?? null) : null),
      getInteger: () => options.hours,
      getChannel: () => null,
    },
    reply: async (payload: { content: string }) => void replies.push(payload.content),
  } as never);

test('без права «Управлять каналами» — понятный отказ', async () => {
  await run({ name: 'x', hours: 1 }, false);
  assert.match(replies.at(-1)!, /Управлять каналами/);
  assert.equal(created, null);
});

test('канал создаётся в той же категории и удаляется по сроку — даже после перезапуска', async () => {
  mock.timers.enable({ apis: ['Date'], now: 1_000_000_000_000 });
  try {
    await run({ name: 'турнир-суббота', hours: 2 });
    assert.deepEqual({ name: created!.name, type: created!.type, parent: created!.parent }, { name: 'турнир-суббота', type: ChannelType.GuildText, parent: 'cat' });
    assert.equal(tempChannelExpiry('ch1'), 1_000_000_000_000 + 2 * HOUR);
    assert.match(replies.at(-1)!, /создан и удалится/);

    await expireTempChannels(client as never);
    assert.deepEqual(deleted, [], 'срок ещё не вышел');
    mock.timers.tick(2 * HOUR);
    await expireTempChannels(client as never); // берёт срок только из базы
    assert.deepEqual(deleted, ['ch1']);
    assert.equal(tempChannelExpiry('ch1'), null);
  } finally {
    mock.timers.reset();
  }
});

test('голосовой с людьми ждёт, пока опустеет; удалённый руками — просто забываем', async () => {
  mock.timers.enable({ apis: ['Date'], now: 1_000_000_000_000 });
  try {
    await run({ name: 'голос-ивент', hours: 1, type: 'voice' });
    const voice = [...channels.values()].at(-1)!;
    assert.equal(voice.type, ChannelType.GuildVoice);
    voice.members.set('u1', {});

    mock.timers.tick(HOUR);
    await expireTempChannels(client as never);
    assert.equal(deleted.includes(voice.id), false, 'там сидят — не удаляем');
    voice.members.clear();
    await expireTempChannels(client as never);
    assert.ok(deleted.includes(voice.id));

    await run({ name: 'удалят-руками', hours: 1 });
    const manual = [...channels.values()].at(-1)!;
    channels.delete(manual.id);
    mock.timers.tick(HOUR);
    await expireTempChannels(client as never);
    assert.equal(tempChannelExpiry(manual.id), null);
  } finally {
    mock.timers.reset();
  }
});
