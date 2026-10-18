import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.BOT_DB_PATH = ':memory:';
const { computeAttendance } = await import('./attendance.ts');

const signup = (userId: string, order: number, tentative = false, reserve = false) => ({
  raidId: 1,
  userId,
  specId: 'mage_fire',
  displayName: userId,
  tentative,
  reserve,
  createdAt: order,
});

// Состав на 3 места: a, b, c — основа, d — запас, e — под вопросом.
const signups = [signup('a', 1), signup('b', 2), signup('c', 3), signup('d', 4), signup('e', 5, true)];
const ids = (list: { userId: string }[]) => list.map((s) => s.userId);

test('кто пришёл и кто нет из основного состава', () => {
  const result = computeAttendance(signups, 3, new Set(['a', 'c', 'd']), false);
  assert.deepEqual(ids(result.present), ['a', 'c', 'd']);
  assert.deepEqual(ids(result.absent), ['b']); // запас «d» в отсутствующие не попадает
  assert.deepEqual(ids(result.tentativeAbsent), ['e']);
  assert.equal(result.mainCount, 3);
  assert.deepEqual(result.walkins, []);
});

test('пришедшие без записи считаются, только если выбран голосовой канал рейда', () => {
  const inVoice = new Set(['a', 'b', 'c', 'x']);
  assert.deepEqual(computeAttendance(signups, 3, inVoice, false).walkins, []);
  assert.deepEqual(computeAttendance(signups, 3, inVoice, true).walkins, ['x']);
});

test('«под вопросом», но пришёл — в списке пришедших', () => {
  const result = computeAttendance(signups, 3, new Set(['a', 'b', 'c', 'e']), false);
  assert.ok(ids(result.present).includes('e'));
  assert.deepEqual(result.tentativeAbsent, []);
  assert.deepEqual(result.absent, []);
});

test('записанный только в запас (гость) не занимает место в основе и не считается отсутствующим', () => {
  // g записался первым, но только в запас: основа — a, b, c, а d уже в запасе по переполнению.
  const withGuest = [signup('g', 0, false, true), ...signups];
  const result = computeAttendance(withGuest, 3, new Set(['a', 'b', 'c', 'g']), false);
  assert.deepEqual(ids(result.absent), []);
  assert.equal(result.mainCount, 3);
  assert.ok(ids(result.present).includes('g'), 'пришёл из запаса — в списке пришедших');
});
