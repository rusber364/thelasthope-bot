import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.BOT_DB_PATH = ':memory:';
const { attendanceRecords, checkedRaids, kindOf, summarize } = await import('./attendanceStats.ts');
const { history } = await import('../commands/raids/history.ts');
const { createRaid, markAttendanceDone, saveAttendance, setTentative, upsertSignup } = await import('./store.ts');

const DAY = 86_400_000;
const now = Date.now();

// Три проверенных рейда за последние дни и один старый — вне периода.
const raids = [1, 2, 3, 40].map((daysAgo, i) => {
  const raid = createRaid({ guildId: 'g', channelId: 'c', title: `Рейд ${i + 1}`, startsAt: now - daysAgo * DAY, size: 40, createdBy: 'o' });
  markAttendanceDone(raid.id);
  return raid;
});
const mark = (raidIndex: number, userId: string, status: 'present' | 'absent' | 'tentative_absent' | 'walkin', tentative = false) => {
  const raid = raids[raidIndex]!;
  if (status !== 'walkin') {
    upsertSignup(raid.id, userId, 'mage_fire', userId);
    if (tentative) setTentative(raid.id, userId, true);
  }
  saveAttendance(raid.id, [{ userId, status }]);
};
mark(0, 'u1', 'present');
mark(1, 'u1', 'absent');
mark(2, 'u1', 'present', true); // «под вопросом», но пришёл
mark(3, 'u1', 'absent'); // 40 дней назад — не в периоде
mark(0, 'u2', 'tentative_absent', true);
mark(1, 'u2', 'present');
mark(2, 'u3', 'walkin');

test('вид отметки учитывает «под вопросом»', () => {
  assert.equal(kindOf('present', false), 'present');
  assert.equal(kindOf('present', true), 'tentativePresent');
  assert.equal(kindOf('tentative_absent', true), 'tentativeAbsent');
  assert.equal(kindOf('walkin', false), 'walkin');
});

test('сводка за период: проценты, «под вопросом» не считается пропуском, сначала пропускающие', () => {
  const records = attendanceRecords('g', now - 30 * DAY, now + DAY);
  assert.equal(records.length, 6, 'рейд 40-дневной давности не попал');
  assert.equal(checkedRaids('g', now - 30 * DAY, now + DAY), 3);

  const summary = summarize(records);
  assert.deepEqual(
    summary.map((row) => [row.userId, row.rate]),
    [['u1', 67], ['u2', 100], ['u3', null]],
  );
  const u1 = summary[0]!;
  assert.deepEqual([u1.present, u1.tentativePresent, u1.absent], [1, 1, 1]);
  const u2 = summary[1]!;
  assert.deepEqual([u2.present, u2.tentativeAbsent], [1, 1], '«под вопросом» и не было — не пропуск');
});

test('/history: сводка игрока и последние рейды', async () => {
  let reply: { embeds: { data: { fields?: { name: string; value: string }[] } }[] } | null = null;
  await history.execute({
    guild: { id: 'g' },
    options: { getUser: () => ({ id: 'u1', displayName: 'Морозко' }), getInteger: () => null },
    reply: async (payload: never) => void (reply = payload),
  } as never);
  const fields = reply!.embeds[0]!.data.fields!;
  assert.equal(fields.find((f) => f.name === 'Посещаемость')!.value, '**67%**');
  assert.equal(fields.find((f) => f.name === '❌ пропуск')!.value, '1');
  const last = fields.find((f) => f.name === 'Последние рейды')!.value.split('\n');
  assert.equal(last.length, 3);
  assert.match(last[0]!, /^✅ .* · Рейд 1$/, 'свежие сверху');
  assert.match(last[2]!, /^☑️ .* · Рейд 3$/, '«под вопросом», но на рейде');
});
