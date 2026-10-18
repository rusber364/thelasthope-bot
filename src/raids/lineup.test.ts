import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.BOT_DB_PATH = ':memory:';
const { lineup, signupAccess } = await import('./lineup.ts');
const { accessNote } = await import('./render.ts');

const signup = (userId: string, extra: { tentative?: boolean; reserve?: boolean } = {}) => ({
  raidId: 1,
  userId,
  specId: 'mage_fire',
  displayName: userId,
  tentative: extra.tentative ?? false,
  reserve: extra.reserve ?? false,
  createdAt: 0,
});
const ids = (list: { userId: string }[]) => list.map((s) => s.userId);

test('состав: основа без «только в запас», запас — переполнение и затем записанные в запас', () => {
  const result = lineup([signup('guest', { reserve: true }), signup('a'), signup('b'), signup('c'), signup('maybe', { tentative: true })], 2);
  assert.deepEqual(ids(result.main), ['a', 'b']);
  assert.deepEqual(ids(result.bench), ['c', 'guest']);
  assert.deepEqual(ids(result.tentative), ['maybe']);
});

test('доступ к записи по ролям', () => {
  const open = { mainRoleIds: [], reserveRoleIds: [] };
  const raiders = { mainRoleIds: ['RAIDER', 'RL'], reserveRoleIds: ['GUEST'] };
  assert.equal(signupAccess(new Set(), open), 'main', 'ограничений нет — все в основу');
  assert.equal(signupAccess(new Set(['RL']), raiders), 'main');
  assert.equal(signupAccess(new Set(['GUEST', 'RAIDER']), raiders), 'main', 'роль основы важнее роли запаса');
  assert.equal(signupAccess(new Set(['GUEST']), raiders), 'reserve');
  assert.equal(signupAccess(new Set(['OTHER']), raiders), null);
});

test('строка на реге: для кого рега', () => {
  assert.equal(accessNote({ mainRoleIds: [], reserveRoleIds: [] }), null);
  assert.match(accessNote({ mainRoleIds: ['R'], reserveRoleIds: [] })!, /Записываются: <@&R>$/);
  assert.match(accessNote({ mainRoleIds: ['R', 'L'], reserveRoleIds: ['G'] })!, /Записываются: <@&R>, <@&L> · только в запас: <@&G>/);
});
