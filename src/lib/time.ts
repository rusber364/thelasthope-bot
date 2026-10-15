// Работа с датами в часовом поясе сервера (settings.timeZone) через встроенный в Node Temporal.
import { settings } from '../settings.ts';

export function nowZoned(): Temporal.ZonedDateTime {
  return Temporal.Now.zonedDateTimeISO(settings.timeZone);
}

/** «20:00» или «9:30» → время. null, если формат неверный. */
export function parseTime(input: string): Temporal.PlainTime | null {
  const match = /^(\d{1,2})[:.](\d{2})$/.exec(input.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return new Temporal.PlainTime(hour, minute);
}

/** «сегодня», «завтра», «17.10», «17.10.2026» или «2026-10-17» → дата. null, если не разобрать. */
export function parseDate(input: string, today = nowZoned().toPlainDate()): Temporal.PlainDate | null {
  const text = input.trim().toLowerCase();
  if (text === 'сегодня') return today;
  if (text === 'завтра') return today.add({ days: 1 });
  if (text === 'послезавтра') return today.add({ days: 2 });

  try {
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (iso) return Temporal.PlainDate.from({ year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) }, { overflow: 'reject' });

    const dotted = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/.exec(text);
    if (!dotted) return null;
    const day = Number(dotted[1]);
    const month = Number(dotted[2]);
    if (dotted[3]) {
      const year = dotted[3].length === 2 ? 2000 + Number(dotted[3]) : Number(dotted[3]);
      return Temporal.PlainDate.from({ year, month, day }, { overflow: 'reject' });
    }
    // Год не указан: берём ближайшую такую дату, не раньше сегодняшней.
    const thisYear = Temporal.PlainDate.from({ year: today.year, month, day }, { overflow: 'reject' });
    return Temporal.PlainDate.compare(thisYear, today) >= 0 ? thisYear : thisYear.add({ years: 1 });
  } catch {
    return null;
  }
}

/** Дата + время в часовом поясе сервера → момент времени (мс с 1970 года). */
export function toEpochMs(date: Temporal.PlainDate, time: Temporal.PlainTime): number {
  return date.toZonedDateTime({ timeZone: settings.timeZone, plainTime: time }).epochMilliseconds;
}

/** Самый поздний момент «день недели из days + время» не позже now (ищем в пределах недели). */
export function latestSlot(
  now: Temporal.ZonedDateTime,
  days: readonly number[],
  time: Temporal.PlainTime,
): Temporal.ZonedDateTime | null {
  for (let back = 0; back < 8; back++) {
    const date = now.toPlainDate().subtract({ days: back });
    if (!days.includes(date.dayOfWeek)) continue;
    const slot = date.toZonedDateTime({ timeZone: now.timeZoneId, plainTime: time });
    if (Temporal.ZonedDateTime.compare(slot, now) <= 0) return slot;
  }
  return null;
}
