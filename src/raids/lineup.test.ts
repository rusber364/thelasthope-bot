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

const spec = (userId: string, specId: string, extra: { tentative?: boolean; reserve?: boolean } = {}) => ({ ...signup(userId, extra), specId });
const DUNGEON = { tank: 1, healer: 1, dps: 3 };

test('подземелье 1/1/3: второй танк — в запас при свободных местах; ушёл танк — запасной поднимается', async () => {
  const { fullGroups } = await import('./lineup.ts');
  const list = [spec('tank1', 'warrior_prot'), spec('tank2', 'paladin_prot'), spec('heal', 'priest_holy'), spec('dps1', 'mage_fire')];
  const first = lineup(list, 5, DUNGEON);
  assert.deepEqual(ids(first.main), ['tank1', 'heal', 'dps1']);
  assert.deepEqual(ids(first.bench), ['tank2'], 'места есть, но танк уже один');
  assert.deepEqual([...fullGroups(list, 5, DUNGEON, 'someone')].sort(), ['healer', 'tank']);
  assert.deepEqual([...fullGroups(list, 5, DUNGEON, 'tank1')], [], 'первый по очереди при смене спека сохраняет номер — место найдётся в любой роли');
  assert.deepEqual([...fullGroups(list, 5, DUNGEON, 'dps1')].sort(), ['healer', 'tank'], 'записавшемуся позже танк и лекарь уже недоступны');

  const leftTank = lineup(list.filter((s) => s.userId !== 'tank1'), 5, DUNGEON);
  assert.deepEqual(ids(leftTank.main), ['tank2', 'heal', 'dps1'], 'запасной танк поднялся');

  const switched = lineup([spec('tank1', 'warrior_arms'), ...list.slice(1)], 5, DUNGEON);
  assert.deepEqual(ids(switched.main), ['tank1', 'tank2', 'heal', 'dps1'], 'первый танк стал бойцом — второй танк в основе');
});

test('лимиты вместе с «под вопросом», «только в запас» и общим числом мест', () => {
  const list = [
    spec('maybe', 'warrior_prot', { tentative: true }),
    spec('guest', 'priest_holy', { reserve: true }),
    spec('d1', 'mage_fire'),
    spec('d2', 'rogue_combat'),
    spec('d3', 'hunter_mm'),
    spec('d4', 'warlock_destro'),
  ];
  const result = lineup(list, 5, DUNGEON);
  assert.deepEqual(ids(result.main), ['d1', 'd2', 'd3'], 'бойцов не больше трёх, хотя мест пять');
  assert.deepEqual(ids(result.bench), ['d4', 'guest'], 'сначала не поместившиеся, потом «только в запас»');
  assert.deepEqual(ids(result.tentative), ['maybe']);
  assert.deepEqual(ids(lineup(list, 2, { tank: null, healer: null, dps: null }).main), ['d1', 'd2'], 'без лимитов — первые по порядку');
});

test('почему в запасе и строка состава на реге', async () => {
  const { benchReason } = await import('./handlers.ts');
  const { kindNote } = await import('./render.ts');
  const raid = { size: 5, limits: DUNGEON };
  const main = [spec('tank1', 'warrior_prot'), spec('heal', 'priest_holy')];
  assert.equal(benchReason(main, raid, 'tank'), 'Танки уже набраны (1/1), поэтому ты в запасе.');
  assert.equal(benchReason(main, { size: 2, limits: DUNGEON }, 'melee'), 'Основной состав уже заполнен, поэтому ты в запасе.');
  assert.equal(kindNote({ kind: 'dungeon', size: 5, limits: DUNGEON }), '**Подземелье** · 5 мест · 1 танк, 1 лекарь, 3 бойца');
  assert.equal(kindNote({ kind: 'pvp', size: 10, limits: { tank: null, healer: 2, dps: null } }), '**PvP** · 10 мест · 2 лекаря');
  assert.equal(kindNote({ kind: 'raid', size: 25, limits: { tank: null, healer: null, dps: null } }), null, 'обычный рейд — без лишней строки');
});
