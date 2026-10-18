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

test('реги по расписанию проверяются в начале каждой минуты, а не раз в 30 секунд от запуска', async () => {
  const { msToNextMinute } = await import('./scheduler.ts');
  const at = (iso: string) => Date.parse(iso);
  assert.equal(msToNextMinute(at('2026-10-18T16:06:59.900Z')), 600, 'за 0,1 с до 19:07 — проверка в 19:07:00,5');
  assert.equal(msToNextMinute(at('2026-10-18T16:07:00.500Z')), MINUTE, 'сразу после проверки — следующая через минуту');
  assert.equal(msToNextMinute(at('2026-10-18T16:07:26.000Z')), 34_500);
});

test('при записи бот обещает только те напоминания, которые ещё впереди', async () => {
  const { reminderNote } = await import('./handlers.ts');
  const HOUR = 60 * MINUTE;
  assert.match(reminderNote(3 * 24 * HOUR), /за сутки и за час/);
  assert.match(reminderNote(5 * HOUR), /за час до начала/);
  assert.doesNotMatch(reminderNote(5 * HOUR), /сутки/);
  assert.match(reminderNote(53 * MINUTE), /меньше часа — общего напоминания в личку уже не будет.*«Напомнить»/);
});
