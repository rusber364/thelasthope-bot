import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

process.env.BOT_DB_PATH = ':memory:';
const { sendReminders } = await import('./scheduler.ts');
const { createRaid, getRaid, upsertSignup } = await import('./store.ts');

// Подставной клиент: запоминает, кому и что бот написал в личку.
const dms: { userId: string; text: string }[] = [];
const client = { users: { fetch: async (id: string) => ({ send: async (text: string) => void dms.push({ userId: id, text }) }) } };

const MINUTE = 60_000;
const raidStartingIn = (ms: number) => {
  const raid = createRaid({ guildId: 'g', channelId: 'c', title: 'Огненные Недра', startsAt: Date.now() + ms, size: 40, createdBy: 'o' });
  upsertSignup(raid.id, 'u1', 'mage-fire', 'Морозко');
  return raid;
};

test('до рейда меньше часа, а «за сутки» ещё не было — одно напоминание, а не два', async () => {
  dms.length = 0;
  const raid = raidStartingIn(30 * MINUTE);
  await sendReminders(client as never);
  assert.equal(dms.length, 1);
  await sendReminders(client as never);
  assert.equal(dms.length, 1, 'повторно не шлём');
  assert.ok(getRaid(raid.id));
});

test('обычный случай: за сутки и за час — по одному напоминанию в своё время', async () => {
  mock.timers.enable({ apis: ['Date'], now: 1_000_000_000_000 });
  try {
    dms.length = 0;
    raidStartingIn(23 * 60 * MINUTE);
    await sendReminders(client as never);
    assert.equal(dms.length, 1, 'за сутки');

    mock.timers.tick(22 * 60 * MINUTE + 1);
    await sendReminders(client as never);
    assert.equal(dms.length, 2, 'за час');

    await sendReminders(client as never);
    assert.equal(dms.length, 2);
  } finally {
    mock.timers.reset();
  }
});
