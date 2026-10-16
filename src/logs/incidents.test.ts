import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { Collection, Events, PermissionFlagsBits } from 'discord.js';

process.env.BOT_DB_PATH = ':memory:';
const { actionProblem, buildIncident, incidentHandler, isNewAccount, mentionStats } = await import('./incidents.ts');
const { registerProfanityFilter } = await import('../events/profanityFilter.ts');
const { getSettings, saveSettings } = await import('../botSettings.ts');

const DAY = 86_400_000;

// Подставной сервер: канал инцидентов I, лог-модерация M; участники с ролями разной высоты.
const posted: { channel: string; payload: { embeds: { data: { title?: string; fields?: { name: string; value: string }[] } }[]; components?: unknown[] } }[] = [];
const channel = (id: string) => ({ id, isSendable: () => true, send: async (payload: never) => void posted.push({ channel: id, payload }) });
const role = (position: number) => ({ position, comparePositionTo: (other: { position: number }) => position - other.position });
const timeouts: string[] = [];
const bans: string[] = [];
const memberOf = (id: string, position: number, perms: bigint[]) => ({
  id,
  user: { id, tag: `${id}#0001`, toString: () => `<@${id}>` },
  roles: { highest: role(position) },
  permissions: { has: (p: bigint) => perms.includes(p) },
  moderatable: true,
  bannable: true,
  timeout: async () => void timeouts.push(id),
  toString: () => `<@${id}>`,
});
const members = new Map([
  ['mod', memberOf('mod', 5, [PermissionFlagsBits.ModerateMembers])],
  ['admin', memberOf('admin', 9, [PermissionFlagsBits.ModerateMembers, PermissionFlagsBits.BanMembers])],
  ['spammer', memberOf('spammer', 1, [])],
]);
const guild = {
  id: 'g',
  ownerId: 'owner',
  channels: { cache: new Map([['I', channel('I')], ['M', channel('M')]]) },
  members: { fetch: async (id: string) => members.get(id) ?? Promise.reject(new Error('Unknown Member')), ban: async (id: string) => void bans.push(id) },
};
const s = structuredClone(getSettings());
s.alerts.incidentChannelId = 'I';
s.logs.moderation = { channelId: 'M', enabled: true };
saveSettings(s);

const card = buildIncident({ kind: 'profanity', user: { id: 'spammer', tag: 'spammer#0001', createdTimestamp: Date.now() - DAY }, channelId: 'C', details: 'мат' });
const press = async (who: string, customId: string) => {
  const log: { kind: string; payload: { content?: string; embeds?: { data: { fields?: { name: string; value: string }[] } }[]; components?: unknown[] } }[] = [];
  const cardMessage = { id: 'card', url: 'https://discord.com/channels/g/I/card', embeds: card.embeds.map((e) => e.toJSON()), edit: async (payload: never) => void log.push({ kind: 'cardEdit', payload }) };
  const [, ...args] = customId.split(':');
  await incidentHandler.handle(
    {
      isButton: () => true,
      guild,
      member: members.get(who),
      user: members.get(who)!.user,
      message: cardMessage,
      channel: { messages: { fetch: async () => cardMessage } },
      client: { users: { fetch: async (id: string) => ({ id, tag: `${id}#0001`, toString: () => `<@${id}>` }) } },
      update: async (payload: never) => void log.push({ kind: 'update', payload }),
      reply: async (payload: never) => void log.push({ kind: 'reply', payload }),
    } as never,
    args,
  );
  return log;
};
const modLogTitles = () => posted.filter((p) => p.channel === 'M').map((p) => p.payload.embeds[0]!.data.title);

test('карточка: кто, когда создан аккаунт, где, что случилось и три кнопки', () => {
  const data = card.embeds[0]!.toJSON();
  assert.equal(data.title, '🤬 Мат в чате');
  assert.deepEqual(data.fields!.map((f) => f.name), ['Участник', 'Аккаунт создан', 'Канал', 'Что случилось']);
  const ids = card.components[0]!.toJSON().components.map((c) => ('custom_id' in c ? c.custom_id : ''));
  assert.deepEqual(ids, ['incident:mute:spammer', 'incident:ban:spammer', 'incident:skip:spammer']);
});

test('подозрительное: новый аккаунт, массовые упоминания, @everyone без права', () => {
  assert.equal(isNewAccount(Date.now() - DAY), true);
  assert.equal(isNewAccount(Date.now() - 10 * DAY), false);
  const mentions = (users: number, roles: number, content = '') => ({ content, mentions: { users: { size: users }, roles: { size: roles } } }) as never;
  assert.deepEqual(mentionStats(mentions(3, 2), false), { count: 5, tryEveryone: false });
  assert.deepEqual(mentionStats(mentions(0, 0, 'эй @everyone'), false), { count: 0, tryEveryone: true });
  assert.deepEqual(mentionStats(mentions(0, 0, 'эй @everyone'), true), { count: 0, tryEveryone: false });
});

test('права нажавшего: нужное право и роль выше нарушителя', () => {
  const spammer = members.get('spammer') as never;
  assert.match(actionProblem(members.get('spammer') as never, spammer, PermissionFlagsBits.ModerateMembers, 'owner')!, /Модерировать участников/);
  assert.match(actionProblem(members.get('mod') as never, spammer, PermissionFlagsBits.BanMembers, 'owner')!, /Банить участников/);
  assert.match(actionProblem(members.get('mod') as never, members.get('admin') as never, PermissionFlagsBits.ModerateMembers, 'owner')!, /не ниже твоей/);
  assert.equal(actionProblem(members.get('mod') as never, spammer, PermissionFlagsBits.ModerateMembers, 'owner'), null);
});

test('«Мут 1 ч» и «Пропустить»: действие, решение на карточке, запись в лог-модерация', async () => {
  const noRights = await press('spammer', 'incident:mute:spammer');
  assert.equal(noRights[0]!.kind, 'reply');
  assert.deepEqual(timeouts, []);

  const muted = await press('mod', 'incident:mute:spammer');
  assert.deepEqual(timeouts, ['spammer']);
  assert.equal(muted[0]!.kind, 'update');
  assert.deepEqual(muted[0]!.payload.components, [], 'кнопки убраны');
  assert.match(muted[0]!.payload.embeds![0]!.data.fields!.at(-1)!.value, /Мут на 1 ч — <@mod>/);

  await press('mod', 'incident:skip:spammer');
  assert.deepEqual(modLogTitles().slice(-2), ['🔇 Мут по инциденту', '✅ Инцидент пропущен']);
});

test('«Бан» — только с подтверждением и правом «Банить»', async () => {
  const modTry = await press('mod', 'incident:ban:spammer');
  assert.match(modTry[0]!.payload.content!, /Банить участников/);

  const ask = await press('admin', 'incident:ban:spammer');
  assert.equal(ask[0]!.kind, 'reply');
  assert.match(ask[0]!.payload.content!, /Точно забанить/);
  assert.deepEqual(bans, [], 'пока не подтвердили — не баним');

  const done = await press('admin', 'incident:banok:spammer:card');
  assert.deepEqual(bans, ['spammer']);
  assert.deepEqual(done.map((entry) => entry.kind), ['update', 'cardEdit']);
  assert.equal(modLogTitles().at(-1), '⛔ Бан по инциденту');
});

test('мат в чате → сообщение удалено и карточка в канале инцидентов', async () => {
  const before = posted.filter((p) => p.channel === 'I').length;
  const client = new EventEmitter();
  registerProfanityFilter(client as never);
  const author = { id: 'spammer', tag: 'spammer#0001', bot: false, createdTimestamp: Date.now() - DAY, toString: () => '<@spammer>' };
  let deleted = false;
  client.emit(Events.MessageCreate, {
    id: 'm1',
    partial: false,
    system: false,
    inGuild: () => true,
    author,
    member: null,
    channelId: 'C',
    content: 'бля, опять вайп',
    guild: { ...guild, members: { fetch: async () => null } },
    client: { user: { id: 'bot', tag: 'Bot#0001', toString: () => '<@bot>' } },
    channel: { toString: () => '<#C>', send: async () => ({ delete: async () => {} }) },
    delete: async () => void (deleted = true),
    mentions: { users: new Collection(), roles: new Collection() },
  });
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
  assert.ok(deleted);
  const incidents = posted.filter((p) => p.channel === 'I');
  assert.equal(incidents.length, before + 1);
  assert.equal(incidents.at(-1)!.payload.embeds[0]!.data.title, '🤬 Мат в чате');
});
