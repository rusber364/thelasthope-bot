// Расписание шаблонов рейдов: строка «рейд в такой-то день и время ← рега на него открывается в такой-то день и время».
import type { RaidSlot, RaidTemplate } from '../botSettings.ts';
import { latestSlot, parseTime } from '../lib/time.ts';
import { settings } from '../settings.ts';

/** Через сколько дней после открытия реги идёт рейд: 0–6, а если день тот же и открытие не раньше рейда — через неделю. */
export function daysAfterOpen(slot: RaidSlot): number {
  const days = (slot.raidDay - slot.openDay + 7) % 7;
  if (days) return days;
  const open = parseTime(slot.openTime);
  const raid = parseTime(slot.raidTime);
  return open && raid && Temporal.PlainTime.compare(open, raid) < 0 ? 0 : 7;
}

/** Ключ реги по расписанию: шаблон + дата рейда. По нему бот понимает, что рега уже открыта. */
export function scheduleKey(templateId: string, raidDate: Temporal.PlainDate): string {
  return `${templateId}:${raidDate.toString()}`;
}

export interface Opening {
  template: RaidTemplate;
  slot: RaidSlot;
  key: string;
  startsAt: number;
}

/**
 * Какие реги пора открыть: момент открытия уже наступил (но не больше catchUpHours назад — если бот был выключен),
 * а сам рейд ещё впереди. Шаблоны без канала пропускаются. Открыта ли рега уже, проверяет вызывающий — по key.
 */
export function dueOpenings(now: Temporal.ZonedDateTime, templates: RaidTemplate[], catchUpHours = settings.raids.catchUpHours): Opening[] {
  const due: Opening[] = [];
  for (const template of templates) {
    if (!template.channelId) continue;
    for (const slot of template.slots) {
      const openTime = parseTime(slot.openTime);
      const raidTime = parseTime(slot.raidTime);
      if (!openTime || !raidTime) continue;
      const opened = latestSlot(now, [slot.openDay], openTime);
      if (!opened || now.since(opened).total('hours') > catchUpHours) continue;
      const raidDate = opened.toPlainDate().add({ days: daysAfterOpen(slot) });
      const start = raidDate.toZonedDateTime({ timeZone: now.timeZoneId, plainTime: raidTime });
      if (Temporal.ZonedDateTime.compare(start, now) <= 0) continue;
      due.push({ template, slot, key: scheduleKey(template.id, raidDate), startsAt: start.epochMilliseconds });
    }
  }
  return due;
}

/** Ближайший рейд по строке расписания — для «открыть сейчас», не дожидаясь времени открытия. */
export function nextRaid(now: Temporal.ZonedDateTime, slot: RaidSlot): { date: Temporal.PlainDate; startsAt: number } | null {
  const raidTime = parseTime(slot.raidTime);
  if (!raidTime) return null;
  for (let ahead = 0; ahead <= 7; ahead++) {
    const date = now.toPlainDate().add({ days: ahead });
    if (date.dayOfWeek !== slot.raidDay) continue;
    const start = date.toZonedDateTime({ timeZone: now.timeZoneId, plainTime: raidTime });
    if (Temporal.ZonedDateTime.compare(start, now) > 0) return { date, startsAt: start.epochMilliseconds };
  }
  return null;
}
