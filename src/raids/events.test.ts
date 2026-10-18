import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { GuildScheduledEventEntityType, GuildScheduledEventStatus } from 'discord.js';

process.env.BOT_DB_PATH = ':memory:';
const { eventFields, syncRaidEvent } = await import('./events.ts');
const { createRaid, getRaid, getRaidEventId, setRaidMessage, setRaidStart, setRaidStatus } = await import('./store.ts');
const { getSettings, saveSettings } = await import('../botSettings.ts');

const HOUR = 3_600_000;
const newRaid = (title = 'Огненные Недра') => {
  const raid = createRaid({ guildId: 'g', channelId: 'c', title, description: 'Сбор в 19:45', startsAt: Date.now() + 5 * HOUR, size: 40, createdBy: 'o' });
  setRaidMessage(raid.id, 'm1');
  return getRaid(raid.id)!;
};

// Подставной сервер: запоминает созданные и изменённые события.
const created: Record<string, unknown>[] = [];
const edits: { id: string; data: Record<string, unknown> }[] = [];
let canCreateEvents = true;
let editFails = false;
const guild = {
  members: { me: { permissions: { has: () => canCreateEvents } } },
  scheduledEvents: {
    create: async (data: Record<string, unknown>) => {
      created.push(data);
      return { id: `e${created.length}` };
    },
    edit: async (id: string, data: Record<string, unknown>) => {
      if (editFails) throw new Error('Unknown Guild Scheduled Event');
      edits.push({ id, data });
    },
  },
};
const client = { guilds: { cache: new Map([['g', guild]]) } };

test('поля события: название, начало, конец через 3 часа, место — ссылка на регу', () => {
  const raid = { ...newRaid(), startsAt: 1_000_000_000_000 };
  const fields = eventFields(raid);
  assert.equal(fields.name, 'Огненные Недра');
  assert.equal(fields.scheduledEndTime.getTime() - fields.scheduledStartTime.getTime(), 3 * HOUR);
  assert.equal(fields.entityMetadata.location, `https://discord.com/channels/g/c/m1`);
  assert.match(fields.description, /Сбор в 19:45\n\nЗапись на рейд: https:\/\/discord\.com\/channels\/g\/c\/m1/);
});

test('событие создаётся, переносится вместе с регой, отменяется и отмечается начавшимся', async () => {
  const raid = newRaid();
  await syncRaidEvent(client as never, raid.id);
  assert.equal(created.length, 1);
  assert.equal(created[0]!.entityType, GuildScheduledEventEntityType.External);
  assert.equal(getRaidEventId(raid.id), 'e1');

  setRaidStart(raid.id, raid.startsAt + 2 * HOUR);
  await syncRaidEvent(client as never, raid.id);
  assert.equal(created.length, 1, 'повторно не создаём');
  assert.equal((edits.at(-1)!.data.scheduledStartTime as Date).getTime(), raid.startsAt + 2 * HOUR);

  setRaidStatus(raid.id, 'cancelled');
  await syncRaidEvent(client as never, raid.id);
  assert.deepEqual(edits.at(-1), { id: 'e1', data: { status: GuildScheduledEventStatus.Canceled } });

  const started = newRaid('Логово Ониксии');
  await syncRaidEvent(client as never, started.id);
  setRaidStatus(started.id, 'closed');
  await syncRaidEvent(client as never, started.id);
  assert.deepEqual(edits.at(-1), { id: 'e2', data: { status: GuildScheduledEventStatus.Active } });
});

test('событие удалили руками — при следующем изменении создаётся заново', async () => {
  const raid = newRaid('Зул\'Гуруб');
  await syncRaidEvent(client as never, raid.id);
  const before = created.length;
  editFails = true;
  await syncRaidEvent(client as never, raid.id);
  editFails = false;
  assert.equal(created.length, before + 1);
  assert.equal(getRaidEventId(raid.id), `e${created.length}`);
});

test('нет права «Создавать события» — без ошибок и с одним предупреждением; выключено в админке — не создаём', async () => {
  const warn = mock.method(console, 'warn', () => {});
  try {
    canCreateEvents = false;
    const before = created.length;
    await syncRaidEvent(client as never, newRaid().id);
    await syncRaidEvent(client as never, newRaid().id);
    canCreateEvents = true;
    assert.equal(created.length, before);
    assert.equal(warn.mock.callCount(), 1);

    const s = structuredClone(getSettings());
    s.raids.discordEvents = false;
    saveSettings(s);
    await syncRaidEvent(client as never, newRaid().id);
    assert.equal(created.length, before);
  } finally {
    warn.mock.restore();
  }
});

test('группа, которую открыл игрок, события Discord не создаёт', async () => {
  const before = created.length;
  const raid = createRaid({ guildId: 'g', channelId: 'c', title: 'Мёртвые копи', startsAt: Date.now() + HOUR, size: 5, createdBy: 'p', kind: 'dungeon', player: true });
  setRaidMessage(raid.id, 'mp');
  await syncRaidEvent(client as never, raid.id);
  assert.equal(created.length, before);
  assert.equal(getRaidEventId(raid.id), null);
});
