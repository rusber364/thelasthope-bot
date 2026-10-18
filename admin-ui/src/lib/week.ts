// Неделя рейдов: когда открываются реги и когда идут рейды. Считается так же, как у бота (src/raids/slots.ts).
import type { RaidSlot, RaidTemplate } from '@api';

export const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/** «20:00» → минуты от начала дня; null, если формат неверный. */
function minutes(time: string): number | null {
  const match = /^(\d{1,2})[:.](\d{2})$/.exec(time.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour > 23 || minute > 59 ? null : hour * 60 + minute;
}

/** Сколько минут от открытия реги до рейда: рейд — ближайший такой день после открытия, не дальше недели. */
export function leadMinutes(slot: RaidSlot): number | null {
  const open = minutes(slot.openTime);
  const raid = minutes(slot.raidTime);
  if (open === null || raid === null) return null;
  let days = (slot.raidDay - slot.openDay + 7) % 7;
  if (days === 0 && open >= raid) days = 7;
  return days * 1440 + raid - open;
}

/** «за 1 д 20 ч» — как долго открыта запись до рейда. */
export function leadText(slot: RaidSlot): string {
  const total = leadMinutes(slot);
  if (total === null) return '';
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const mins = total % 60;
  const parts = [days ? `${days} д` : '', hours ? `${hours} ч` : '', mins ? `${mins} мин` : ''].filter(Boolean);
  return `за ${parts.join(' ') || '0 мин'}`;
}

export interface WeekChip {
  kind: 'open' | 'raid';
  time: string;
  title: string;
  /** Номер шаблона — по нему цвет. */
  template: number;
  /** Сколько рег шаблона открывается в это время (вторник 00:00 → среда, четверг, пятница — 3). */
  count: number;
}

/** Семь дней (пн…вс): что в какой день происходит, по времени. Шаблоны без канала не открывают реги — их нет. */
export function weekChips(templates: RaidTemplate[]): WeekChip[][] {
  const week: WeekChip[][] = DAYS.map(() => []);
  const add = (day: number, chip: Omit<WeekChip, 'count'>) => {
    const list = week[day - 1];
    const same = list?.find((c) => c.kind === chip.kind && c.time === chip.time && c.template === chip.template);
    if (same) same.count += 1;
    else list?.push({ ...chip, count: 1 });
  };
  templates.forEach((template, index) => {
    if (!template.channelId) return;
    const title = template.title.trim() || 'Без названия';
    for (const slot of template.slots) {
      if (leadMinutes(slot) === null) continue;
      add(slot.openDay, { kind: 'open', time: slot.openTime, title, template: index });
      add(slot.raidDay, { kind: 'raid', time: slot.raidTime, title, template: index });
    }
  });
  for (const day of week) day.sort((a, b) => (minutes(a.time) ?? 0) - (minutes(b.time) ?? 0) || a.kind.localeCompare(b.kind));
  return week;
}
