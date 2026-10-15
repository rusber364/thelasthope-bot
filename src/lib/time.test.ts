import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDuration, latestSlot, parseDate, parseTime } from './time.ts';

const KYIV = 'Europe/Kyiv';
const at = (iso: string) => Temporal.ZonedDateTime.from(`${iso}[${KYIV}]`);
const THU_FRI_MON = [4, 5, 1];
const MIDNIGHT = new Temporal.PlainTime(0, 0);

test('рега открывается в полночь чт/пт/пн по Киеву', () => {
  // Четверг 15.10.2026, вечер → сегодняшняя полночь
  assert.equal(latestSlot(at('2026-10-15T19:37'), THU_FRI_MON, MIDNIGHT)?.toString(), '2026-10-15T00:00:00+03:00[Europe/Kyiv]');
  // Среда → прошлый понедельник
  assert.equal(latestSlot(at('2026-10-14T10:00'), THU_FRI_MON, MIDNIGHT)?.toPlainDate().toString(), '2026-10-12');
  // Ровно полночь пятницы — уже пора
  assert.equal(latestSlot(at('2026-10-16T00:00'), THU_FRI_MON, MIDNIGHT)?.toPlainDate().toString(), '2026-10-16');
  // Воскресенье → пятница
  assert.equal(latestSlot(at('2026-10-18T23:59'), THU_FRI_MON, MIDNIGHT)?.toPlainDate().toString(), '2026-10-16');
});

test('переход на зимнее время 25.10.2026 учитывается', () => {
  const slot = latestSlot(at('2026-10-26T01:00'), THU_FRI_MON, MIDNIGHT);
  assert.equal(slot?.toString(), '2026-10-26T00:00:00+02:00[Europe/Kyiv]');
});

test('длительность словами', () => {
  assert.equal(formatDuration(80 * 60_000), '1 ч 20 мин');
  assert.equal(formatDuration(5 * 60_000), '5 мин');
  assert.equal(formatDuration(3 * 3_600_000), '3 ч');
  assert.equal(formatDuration(26 * 3_600_000), '1 д 2 ч');
  assert.equal(formatDuration(10_000), '0 мин');
});

test('разбор дат и времени из команд', () => {
  const today = Temporal.PlainDate.from('2026-10-15');
  assert.equal(parseDate('сегодня', today)?.toString(), '2026-10-15');
  assert.equal(parseDate('Завтра', today)?.toString(), '2026-10-16');
  assert.equal(parseDate('17.10', today)?.toString(), '2026-10-17');
  assert.equal(parseDate('01.01', today)?.toString(), '2027-01-01');
  assert.equal(parseDate('4.11.2026', today)?.toString(), '2026-11-04');
  assert.equal(parseDate('2026-11-04', today)?.toString(), '2026-11-04');
  assert.equal(parseDate('31.02', today), null);
  assert.equal(parseDate('когда-нибудь', today), null);

  assert.equal(parseTime('20:00')?.toString(), '20:00:00');
  assert.equal(parseTime('9.30')?.toString(), '09:30:00');
  assert.equal(parseTime('25:00'), null);
});
