import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mock, test } from 'node:test';
import { Events, type ActionRowBuilder, type ButtonBuilder } from 'discord.js';

process.env.BOT_DB_PATH = ':memory:';
const { fillWelcomeDm, sendWelcomeDm } = await import('./dm.ts');
const { registerWelcomeEvent } = await import('../events/guildMemberAdd.ts');
const { getSettings, saveSettings } = await import('../botSettings.ts');

test('подстановки: каналы ссылками, невыбранные — словами', () => {
  const data = { userId: '7', name: 'Морозко', server: 'The Last Hope', rules: 'RU', auth: null, welcome: 'W', role: 'Гость' };
  assert.equal(
    fillWelcomeDm('{user} {name} в {server}: {rules}, {auth}, роль «{role}» в {welcome}', data),
    '<@7> Морозко в The Last Hope: <#RU>, авторизацию, роль «Гость» в <#W>',
  );
});

// Подставной сервер: канал приветствий W, роли «Гость» и автороль, каналы правил и авторизации.
const channelPosts: unknown[] = [];
const addedRoles: string[] = [];
const guild = {
  id: 'G',
  name: 'The Last Hope',
  channels: { cache: new Map([['W', { isSendable: () => true, send: async (payload: unknown) => void channelPosts.push(payload) }]]) },
  roles: { cache: new Map([['R', { id: 'R', name: 'Гость' }], ['A', { id: 'A', name: 'Новичок' }]]) },
};
type Dm = { content: string; components: ActionRowBuilder<ButtonBuilder>[] };
const member = (send: (payload: Dm) => Promise<unknown>) => ({
  id: '7',
  displayName: 'Морозко',
  user: { bot: false },
  guild,
  roles: { add: async (role: { id: string }) => void addedRoles.push(role.id) },
  displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
  toString: () => '<@7>',
  send,
});

const s = structuredClone(getSettings());
s.channels = { welcome: 'W', rules: 'RU', auth: 'AU' };
s.roles = { guest: 'R', autorole: 'A' };
saveSettings(s);

test('по умолчанию выключено: в личку ничего не уходит, кроме пробной отправки', async () => {
  const dms: Dm[] = [];
  const m = member(async (payload) => dms.push(payload));
  assert.equal(await sendWelcomeDm(m as never), 'off');
  assert.equal(dms.length, 0);
  assert.equal(await sendWelcomeDm(m as never, true), 'sent');
  assert.equal(dms.length, 1);
});

test('при входе: автороль, приветствие в канале и личка с кнопками на правила и авторизацию', async () => {
  const on = structuredClone(getSettings());
  on.welcomeDm = { enabled: true, text: 'Привет, {name}! Прочитай {rules} и пройди {auth}.' };
  saveSettings(on);
  const dms: Dm[] = [];
  const client = new EventEmitter();
  registerWelcomeEvent(client as never);

  client.emit(Events.GuildMemberAdd, member(async (payload) => dms.push(payload)));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(addedRoles, ['A']);
  assert.equal(channelPosts.length, 1);
  assert.equal(dms.length, 1);
  assert.equal(dms[0]!.content, 'Привет, Морозко! Прочитай <#RU> и пройди <#AU>.');
  const urls = dms[0]!.components[0]!.toJSON().components.map((button) => ('url' in button ? button.url : null));
  assert.deepEqual(urls, ['https://discord.com/channels/G/RU', 'https://discord.com/channels/G/AU']);
});

test('закрытая личка: без ошибок, приветствие в канале и автороль всё равно есть', async () => {
  addedRoles.length = 0;
  channelPosts.length = 0;
  const errors = mock.method(console, 'error', () => {});
  try {
    const closed = member(async () => {
      throw Object.assign(new Error('Cannot send messages to this user'), { code: 50007 });
    });
    assert.equal(await sendWelcomeDm(closed as never), 'closed');

    const client = new EventEmitter();
    registerWelcomeEvent(client as never);
    client.emit(Events.GuildMemberAdd, closed);
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(addedRoles, ['A']);
    assert.equal(channelPosts.length, 1);
    assert.equal(errors.mock.callCount(), 0, 'закрытая личка — не ошибка');
  } finally {
    errors.mock.restore();
  }
});
