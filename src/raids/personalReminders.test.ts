import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

process.env.BOT_DB_PATH = ':memory:';
const { chooseReminder, sendPersonalReminders, showReminderMenu } = await import('./personalReminders.ts');
const { createRaid, getPersonalReminder, getRaid, setRaidStart } = await import('./store.ts');

const MINUTE = 60_000;
type Payload = { content?: string; components?: { toJSON(): { components: { options?: { value: string }[] }[] } }[] };
const interaction = (values: string[] = []) => {
  const log: Payload[] = [];
  return {
    log,
    user: { id: 'u1' },
    values,
    isStringSelectMenu: () => values.length > 0,
    reply: async (payload: Payload) => void log.push(payload),
    update: async (payload: Payload) => void log.push(payload),
  };
};
const options = (payload: Payload) => payload.components![0]!.toJSON().components[0]!.options!.map((o) => o.value);

test('«Напомнить»: выбор времени, смена и отмена', async () => {
  const raid = createRaid({ guildId: 'g', channelId: 'c', title: 'Огненные Недра', startsAt: Date.now() + 3 * 60 * MINUTE, size: 40, createdBy: 'o' });

  const menu = interaction();
  await showReminderMenu(menu as never, raid);
  assert.deepEqual(options(menu.log[0]!), ['10', '30', '60', '120'], 'без напоминания — без «Не напоминать»');

  const pick = interaction(['30']);
  await chooseReminder(pick as never, raid);
  assert.equal(getPersonalReminder(raid.id, 'u1'), 30);
  assert.match(pick.log[0]!.content!, /за 30 мин до начала/);

  const again = interaction();
  await showReminderMenu(again as never, raid);
  assert.deepEqual(options(again.log[0]!), ['10', '30', '60', '120', '0']);
  assert.match(again.log[0]!.content!, /Сейчас: за 30 мин/);

  await chooseReminder(interaction(['0']) as never, raid);
  assert.equal(getPersonalReminder(raid.id, 'u1'), null);
});

test('время напоминания уже прошло — просим выбрать поменьше', async () => {
  const raid = createRaid({ guildId: 'g', channelId: 'c', title: 'Зул\'Гуруб', startsAt: Date.now() + 20 * MINUTE, size: 20, createdBy: 'o' });
  const pick = interaction(['30']);
  await chooseReminder(pick as never, raid);
  assert.equal(getPersonalReminder(raid.id, 'u1'), null);
  assert.match(pick.log[0]!.content!, /уже меньше 30 мин/);
});

test('личка приходит в выбранное время один раз; перенос рейда — напомнит снова', async () => {
  mock.timers.enable({ apis: ['Date'], now: 1_000_000_000_000 });
  try {
    const dms: string[] = [];
    const client = { users: { fetch: async () => ({ send: async (text: string) => void dms.push(text) }) } };
    const raid = createRaid({ guildId: 'g', channelId: 'c', title: 'Логово Ониксии', startsAt: Date.now() + 120 * MINUTE, size: 40, createdBy: 'o' });
    await chooseReminder(interaction(['30']) as never, raid);

    await sendPersonalReminders(client as never);
    mock.timers.tick(89 * MINUTE);
    await sendPersonalReminders(client as never);
    assert.equal(dms.length, 0, 'ещё рано');

    mock.timers.tick(MINUTE);
    await sendPersonalReminders(client as never);
    await sendPersonalReminders(client as never);
    assert.equal(dms.length, 1);
    assert.match(dms[0]!, /Твоё напоминание.*Логово Ониксии/);

    setRaidStart(raid.id, getRaid(raid.id)!.startsAt + 60 * MINUTE);
    mock.timers.tick(60 * MINUTE);
    await sendPersonalReminders(client as never);
    assert.equal(dms.length, 2, 'после переноса — от нового времени');
  } finally {
    mock.timers.reset();
  }
});
