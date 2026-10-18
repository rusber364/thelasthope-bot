import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RaidSlot, RaidTemplate } from '../botSettings.ts';
import { daysAfterOpen, dueOpenings, nextRaid, scheduleKey } from './slots.ts';

const KYIV = 'Europe/Kyiv';
const at = (iso: string) => Temporal.PlainDateTime.from(iso).toZonedDateTime(KYIV);
const slot = (raidDay: number, raidTime: string, openDay: number, openTime: string): RaidSlot => ({ raidDay, raidTime, openDay, openTime });
const template = (slots: RaidSlot[], extra: Partial<RaidTemplate> = {}): RaidTemplate => ({
  id: 'main',
  title: 'Основной статик',
  description: '',
  size: 25,
  time: '20:00',
  channelId: 'R1',
  pingRoleIds: [],
  mainRoleIds: [],
  reserveRoleIds: [],
  slots,
  ...extra,
});
const local = (ms: number) => Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(KYIV).toPlainDateTime().toString({ smallestUnit: 'minute' });

// 20.10.2026 — вторник, 23.10 — пятница, 26.10 — понедельник.
test('рейд после открытия: в среду после вторника, в понедельник после пятницы, в тот же день или через неделю', () => {
  assert.equal(daysAfterOpen(slot(3, '20:00', 2, '00:00')), 1);
  assert.equal(daysAfterOpen(slot(1, '20:00', 5, '23:00')), 3);
  assert.equal(daysAfterOpen(slot(4, '20:00', 4, '00:00')), 0, 'утром открыли — вечером рейд');
  assert.equal(daysAfterOpen(slot(4, '20:00', 4, '20:00')), 7, 'открытие не раньше рейда — рейд через неделю');
});

test('во вторник в 00:00 открываются реги на среду, четверг и пятницу; в пятницу — на понедельник', () => {
  const main = template([slot(3, '20:00', 2, '00:00'), slot(4, '20:00', 2, '00:00'), slot(5, '20:00', 2, '00:00'), slot(1, '20:00', 5, '23:00')]);

  const tuesday = dueOpenings(at('2026-10-20T00:00:30'), [main], 6);
  assert.deepEqual(
    tuesday.map((o) => [o.key, local(o.startsAt)]),
    [
      ['main:2026-10-21', '2026-10-21T20:00'],
      ['main:2026-10-22', '2026-10-22T20:00'],
      ['main:2026-10-23', '2026-10-23T20:00'],
    ],
  );

  const friday = dueOpenings(at('2026-10-23T23:05'), [main], 6);
  assert.deepEqual(
    friday.map((o) => [o.key, local(o.startsAt)]),
    [['main:2026-10-26', '2026-10-26T20:00']],
    'пятничный рейд уже начался — открывается только понедельник; рейд 26.10 уже по зимнему времени',
  );
});

test('окно догоняния: бот был выключен — рега открывается позже, но не дольше catchUpHours и не после начала рейда', () => {
  const main = template([slot(3, '20:00', 2, '00:00'), slot(2, '04:00', 2, '00:00')]);
  assert.deepEqual(
    dueOpenings(at('2026-10-20T05:00'), [main], 6).map((o) => o.key),
    ['main:2026-10-21'],
    'вторничный рейд в 04:00 уже прошёл',
  );
  assert.deepEqual(dueOpenings(at('2026-10-20T06:01'), [main], 6), [], 'больше 6 часов — не догоняем');
  assert.deepEqual(dueOpenings(at('2026-10-19T23:59'), [main], 6), [], 'ещё не наступило');
});

test('шаблон без канала и строки с неверным временем пропускаются', () => {
  const noChannel = template([slot(3, '20:00', 2, '00:00')], { channelId: null });
  const badTime = template([slot(3, '25:00', 2, '00:00')], { id: 'bad' });
  assert.deepEqual(dueOpenings(at('2026-10-20T00:10'), [noChannel, badTime], 6), []);
});

test('«открыть сейчас»: ближайший рейд по строке, сегодняшний — только если он ещё впереди', () => {
  const wednesday = slot(3, '20:00', 2, '00:00');
  const before = nextRaid(at('2026-10-21T19:00'), wednesday)!;
  assert.equal(before.date.toString(), '2026-10-21');
  assert.equal(local(before.startsAt), '2026-10-21T20:00');
  assert.equal(nextRaid(at('2026-10-21T20:00'), wednesday)!.date.toString(), '2026-10-28', 'уже начался — следующая неделя');
  assert.equal(scheduleKey('main', before.date), 'main:2026-10-21');
});
