import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { Events } from 'discord.js';

process.env.BOT_DB_PATH = ':memory:';
const { registerVoiceRoles, syncVoiceRoles, voiceRoleDiff, voiceRoleSync } = await import('./voiceRoles.ts');
const { getSettings, saveSettings } = await import('../botSettings.ts');

// Рейд-голосовой V1 → роль R, голосовые V1 и V2 (оба «рейдовые») → роль S.
const links = [
  { channelId: 'V1', roleId: 'R' },
  { channelId: 'V1', roleId: 'S' },
  { channelId: 'V2', roleId: 'S' },
];

test('вход, выход и переход между каналами', () => {
  assert.deepEqual(voiceRoleDiff(links, null, 'V1'), { add: ['R', 'S'], remove: [] });
  assert.deepEqual(voiceRoleDiff(links, 'V1', null), { add: [], remove: ['R', 'S'] });
  // Переход V1 → V2: R снимается, S остаётся (есть у обоих каналов).
  assert.deepEqual(voiceRoleDiff(links, 'V1', 'V2'), { add: [], remove: ['R'] });
  assert.deepEqual(voiceRoleDiff(links, 'X', 'Y'), { add: [], remove: [] });
});

test('сверка после перезапуска: выдать сидящим в канале, снять у остальных', () => {
  const { add, remove } = voiceRoleSync(links, [
    { id: 'in-v1', channelId: 'V1', roleIds: new Set() },
    { id: 'in-v2-with-r', channelId: 'V2', roleIds: new Set(['R']) },
    { id: 'left', channelId: null, roleIds: new Set(['R', 'S', 'OTHER']) },
    { id: 'ok', channelId: 'V2', roleIds: new Set(['S']) },
  ]);
  assert.deepEqual(add, [['in-v1', 'R'], ['in-v1', 'S'], ['in-v2-with-r', 'S']]);
  assert.deepEqual(remove, [['in-v2-with-r', 'R'], ['left', 'R'], ['left', 'S']]);
});

// Подставной сервер для событий и сверки.
const memberRoles = new Map<string, Set<string>>();
const member = (id: string) => {
  if (!memberRoles.has(id)) memberRoles.set(id, new Set());
  const set = memberRoles.get(id)!;
  return {
    id,
    user: { bot: false },
    roles: {
      cache: { has: (r: string) => set.has(r), keys: () => set.keys() },
      add: async (role: { id: string }) => void set.add(role.id),
      remove: async (role: { id: string }) => void set.delete(role.id),
    },
  };
};
const voice = new Map<string, { channelId: string }>();
const members = new Map(['a', 'b'].map((id) => [id, member(id)]));
const guild = {
  roles: { cache: new Map(['R', 'S'].map((id) => [id, { id, editable: true }])) },
  voiceStates: { cache: voice },
  members: { cache: { filter: (fn: (m: unknown) => boolean) => ({ map: <T>(map: (m: ReturnType<typeof member>) => T) => [...members.values()].filter(fn).map(map) }), get: (id: string) => members.get(id) } },
};
const s = structuredClone(getSettings());
s.voiceRoles = links;
saveSettings(s);

test('событие: роль появляется при входе и пропадает при выходе', async () => {
  const client = new EventEmitter();
  registerVoiceRoles(client as never);
  const state = (channelId: string | null) => ({ channelId, member: members.get('a'), guild });
  client.emit(Events.VoiceStateUpdate, state(null), state('V1'));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual([...memberRoles.get('a')!].sort(), ['R', 'S']);
  client.emit(Events.VoiceStateUpdate, state('V1'), state(null));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual([...memberRoles.get('a')!], []);
});

test('syncVoiceRoles приводит роли сервера в соответствие с голосовыми', async () => {
  voice.set('b', { channelId: 'V2' }); // b сидит в V2, ролей пока нет
  memberRoles.get('a')!.add('R'); // a нигде не сидит, но с ролью R
  await syncVoiceRoles(guild as never);
  assert.deepEqual([...memberRoles.get('b')!], ['S']);
  assert.deepEqual([...memberRoles.get('a')!], []);
});
