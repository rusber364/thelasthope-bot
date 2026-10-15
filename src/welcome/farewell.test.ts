import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { Events } from 'discord.js';

process.env.BOT_DB_PATH = ':memory:';
const { fillFarewell, registerFarewell } = await import('./farewell.ts');
const { getSettings, saveSettings } = await import('../botSettings.ts');

test('подстановки в тексте прощания', () => {
  const text = fillFarewell('{user} ({name}) покидает {server}, осталось {members}', { userId: '7', name: 'Морозко', server: 'The Last Hope', members: 41 });
  assert.equal(text, '<@7> (Морозко) покидает The Last Hope, осталось 41');
});

test('при выходе участника прощание уходит в выбранный канал, боты пропускаются', async () => {
  const sent: { content: string; allowedMentions: unknown }[] = [];
  const channel = { isSendable: () => true, send: async (payload: { content: string; allowedMentions: unknown }) => void sent.push(payload) };
  const guild = { name: 'The Last Hope', memberCount: 41, channels: { cache: new Map([['F', channel]]) } };
  const s = structuredClone(getSettings());
  s.farewell = { channelId: 'F', text: '**{name}** покидает {server}. Нас {members}.' };
  saveSettings(s);

  const client = new EventEmitter();
  registerFarewell(client as never);
  const leave = (bot: boolean) => ({ id: '7', displayName: 'Морозко', user: { bot, username: 'moroz' }, guild });

  client.emit(Events.GuildMemberRemove, leave(false));
  client.emit(Events.GuildMemberRemove, leave(true));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.content, '**Морозко** покидает The Last Hope. Нас 41.');
  assert.deepEqual(sent[0]!.allowedMentions, { parse: [] });
});

test('без канала прощаний ничего не отправляется', async () => {
  const s = structuredClone(getSettings());
  s.farewell.channelId = null;
  saveSettings(s);
  const { sendFarewell } = await import('./farewell.ts');
  assert.equal(await sendFarewell({ id: '1', displayName: 'X', guild: { channels: { cache: new Map() } } } as never), false);
});
