import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.BOT_DB_PATH = ':memory:';
const { raidHandler } = await import('./handlers.ts');
const { cleanupRaidRoles } = await import('./tempRole.ts');
const { createRaid, setRaidStatus } = await import('./store.ts');
const { getSettings, saveSettings } = await import('../botSettings.ts');

const settings = structuredClone(getSettings());
settings.raids.tempRoleId = 'R';
settings.raids.tempRoleHours = 3;
saveSettings(settings);

// Подставной сервер: у каждого участника — набор ролей, бот может выдавать роль R.
const roles = new Map<string, Set<string>>();
const memberOf = (id: string) => {
  if (!roles.has(id)) roles.set(id, new Set());
  const set = roles.get(id)!;
  return {
    id,
    displayName: id,
    toString: () => `<@${id}>`,
    roles: { cache: { has: (r: string) => set.has(r), keys: () => set.values() }, add: async (r: { id: string }) => void set.add(r.id), remove: async (r: { id: string }) => void set.delete(r.id) },
  };
};
const guild = {
  id: 'g',
  channels: { cache: new Map() },
  roles: { cache: new Map([['R', { id: 'R', name: 'Рейд', editable: true }]]) },
  members: { fetch: async (id: string) => memberOf(id) },
};
const client = { channels: { fetch: async () => null }, guilds: { cache: new Map([['g', guild]]) } };
const hasRole = (id: string) => roles.get(id)?.has('R') ?? false;

function press(userId: string, raidId: number, action: 'spec' | 'leave', spec = 'mage_fire') {
  const interaction = {
    user: { id: userId },
    member: memberOf(userId),
    guild,
    client,
    values: [spec],
    isStringSelectMenu: () => action === 'spec',
    isButton: () => action === 'leave',
    isModalSubmit: () => false,
    update: async () => {},
    reply: async () => {},
  };
  return raidHandler.handle(interaction as never, [action, String(raidId)]);
}

const HOUR = 60 * 60 * 1000;
const raidA = createRaid({ guildId: 'g', channelId: 'c', title: 'A', startsAt: Date.now() + 2 * HOUR, size: 40, createdBy: 'u' });
const raidB = createRaid({ guildId: 'g', channelId: 'c', title: 'B', startsAt: Date.now() + 26 * HOUR, size: 40, createdBy: 'u' });

test('роль выдаётся при записи и снимается при отписке', async () => {
  await press('u1', raidA.id, 'spec');
  assert.equal(hasRole('u1'), true);
  await press('u1', raidA.id, 'leave');
  assert.equal(hasRole('u1'), false);
});

test('при отписке роль остаётся, если игрок записан на другой предстоящий рейд', async () => {
  await press('u2', raidA.id, 'spec');
  await press('u2', raidB.id, 'spec');
  await press('u2', raidA.id, 'leave');
  assert.equal(hasRole('u2'), true);
});

test('по сроку и при отмене роль снимается у всех участников (состояние в базе — работает и после перезапуска)', async () => {
  // Рейд, начавшийся 4 часа назад (срок 3 часа), — его участник должен лишиться роли.
  const past = createRaid({ guildId: 'g', channelId: 'c', title: 'Прошедший', startsAt: Date.now() - 4 * HOUR, size: 40, createdBy: 'u' });
  const { upsertSignup } = await import('./store.ts');
  upsertSignup(past.id, 'u3', 'warrior_prot', 'u3');
  roles.set('u3', new Set(['R']));

  // Рейд отменён — роль снимается сразу, не дожидаясь срока.
  upsertSignup(raidB.id, 'u4', 'priest_holy', 'u4');
  roles.set('u4', new Set(['R']));
  setRaidStatus(raidB.id, 'cancelled');

  await cleanupRaidRoles(client as never);
  assert.equal(hasRole('u3'), false, 'прошедший рейд');
  assert.equal(hasRole('u4'), false, 'отменённый рейд');

  // Повторный тик ничего не трогает: роль, выданная вручную, остаётся.
  roles.get('u3')!.add('R');
  await cleanupRaidRoles(client as never);
  assert.equal(hasRole('u3'), true);
});
