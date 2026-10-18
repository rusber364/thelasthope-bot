// Даты и время — как у бота, по Киеву.
const TIME_ZONE = 'Europe/Kyiv';

/** Сегодня по Киеву в виде ГГГГ-ММ-ДД (для полей type="date"). */
export function todayInKyiv(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date());
}

/** ГГГГ-ММ-ДД, сдвинутая на days дней. */
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const dateTime = new Intl.DateTimeFormat('ru-RU', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const dateOnly = new Intl.DateTimeFormat('ru-RU', { timeZone: TIME_ZONE, day: 'numeric', month: 'long' });

export const formatDateTime = (ms: number) => dateTime.format(ms);

/** «18 октября» из ГГГГ-ММ-ДД. */
export const formatDay = (date: string) => dateOnly.format(new Date(`${date}T12:00:00Z`));

const logTime = new Intl.DateTimeFormat('ru-RU', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** «18.10, 19:07:26» — время строки лога бота, по Киеву. */
export const formatLogTime = (ms: number) => logTime.format(ms);

/** 1 строка, 2 строки, 5 строк: plural(n, ['строка', 'строки', 'строк']). */
export function plural(n: number, [one, few, many]: [string, string, string]): string {
  const tens = n % 100;
  const units = n % 10;
  if (units === 1 && tens !== 11) return one;
  if (units >= 2 && units <= 4 && (tens < 12 || tens > 14)) return few;
  return many;
}
