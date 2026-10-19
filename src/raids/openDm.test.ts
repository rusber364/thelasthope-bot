import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.BOT_DB_PATH = ':memory:';
const { DM_PAUSE_MS, handleRaidDmButton, isRaidDmOff, raidDmMessage, raidDmRecipients, sendRaidToDms, setRaidDmOff } = await import('./openDm.ts');
const { createRaid, setRaidMessage, getRaid } = await import('./store.ts');

const raid = (() => {
  const created = createRaid({ guildId: 'G', channelId: 'C', title: 'Хиджал', startsAt: Date.UTC(2026, 9, 20, 17), size: 25, createdBy: 'schedule' });
  setRaidMessage(created.id, 'M');
  return getRaid(created.id)!;
})();

type Sent = { content: string; components: { toJSON(): { components: { custom_id?: string; url?: string; label?: string }[] } }[] };
const buttonsOf = (payload: Sent) => payload.components[0]!.toJSON().components;

test('кому слать: люди с любой из ролей «Упомянуть», без ботов и отписавшихся', () => {
  const members = [
    { id: 'a', bot: false, roleIds: ['static'] },
    { id: 'b', bot: false, roleIds: ['raider'] },
    { id: 'c', bot: false, roleIds: ['raider', 'static'] },
    { id: 'bot', bot: true, roleIds: ['static'] },
    { id: 'off', bot: false, roleIds: ['static'] },
  ];
  assert.deepEqual(raidDmRecipients(members, ['static'], new Set(['off'])), ['a', 'c']);
  assert.deepEqual(raidDmRecipients(members, [], new Set()), [], 'ролей нет — никому');
});

test('сообщение: сервер, вид, название, время; «Открыть регу» ведёт на регу, «Не присылать мне» знает сервер и регу', () => {
  const message = raidDmMessage(raid, 'The Last Hope') as Sent;
  assert.match(message.content, /\*\*The Last Hope\*\*: открылась рега — рейд \*\*Хиджал\*\* <t:\d+:R>/);
  const [open, off] = buttonsOf(message);
  assert.equal(open!.url, 'https://discord.com/channels/G/C/M');
  assert.deepEqual([off!.label, off!.custom_id], ['Не присылать мне', 'raiddm:off:G:C:M']);
});

test('рассылка: по одному сообщению с паузой; закрытая личка не мешает остальным; отписавшимся не шлём', async () => {
  setRaidDmOff('G', 'u3', true);
  const sent: string[] = [];
  const member = (id: string, roles: string[], { bot = false, closed = false } = {}) => ({
    id,
    user: { bot },
    roles: { cache: new Map(roles.map((r) => [r, {}])) },
    send: async () => {
      if (closed) throw new Error('Cannot send messages to this user');
      sent.push(id);
    },
  });
  const members = new Map(
    [member('u1', ['static']), member('u2', ['static'], { closed: true }), member('u3', ['static']), member('u4', ['other']), member('b1', ['static'], { bot: true }), member('u5', ['static'])].map(
      (m) => [m.id, m],
    ),
  );
  const guild = { id: 'G', name: 'The Last Hope', members: { fetch: async () => members } };
  const waits: number[] = [];
  const logs: string[] = [];
  const realLog = console.log;
  console.log = (line: string) => void logs.push(line);
  try {
    await sendRaidToDms(guild as never, raid, ['static'], { wait: async (ms) => void waits.push(ms) });
  } finally {
    console.log = realLog;
  }
  assert.deepEqual(sent, ['u1', 'u5']);
  assert.deepEqual(waits, [DM_PAUSE_MS, DM_PAUSE_MS], 'пауза перед каждым сообщением, кроме первого');
  assert.match(logs.at(-1)!, /Рега #\d+ «Хиджал» в личку: 2 из 3, не дошло 1 \(закрыта личка\)/);
});

test('«Не присылать мне» отписывает и меняет кнопку на «Снова присылать»; та возвращает рассылку', async () => {
  const base = raidDmMessage(raid, 'The Last Hope') as Sent;
  const press = async (customId: string, content: string) => {
    let update: Sent | null = null;
    const interaction = { user: { id: 'u9' }, message: { content }, update: async (payload: Sent) => void (update = payload) };
    await handleRaidDmButton(interaction as never, customId.split(':').slice(1));
    return update! as Sent;
  };

  const afterOff = await press('raiddm:off:G:C:M', base.content);
  assert.equal(isRaidDmOff('G', 'u9'), true);
  assert.match(afterOff.content, /Больше не присылаю реги в личку/);
  const [open, on] = buttonsOf(afterOff);
  assert.equal(open!.url, 'https://discord.com/channels/G/C/M', 'ссылка на регу на месте');
  assert.deepEqual([on!.label, on!.custom_id], ['Снова присылать', 'raiddm:on:G:C:M']);

  const afterOn = await press('raiddm:on:G:C:M', afterOff.content);
  assert.equal(isRaidDmOff('G', 'u9'), false);
  assert.equal(afterOn.content, base.content, 'пометка об отписке убрана');
  assert.equal(buttonsOf(afterOn)[1]!.label, 'Не присылать мне');
  assert.equal(isRaidDmOff('другой сервер', 'u9'), false, 'отписка — на один сервер');
});
