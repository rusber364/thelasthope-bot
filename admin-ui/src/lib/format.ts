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
