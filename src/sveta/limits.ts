// Потолки Светы: пауза для одного человека, ответы в час и в день (счётчик за день — в базе, переживает перезапуск),
// «перерыв», когда все модели Gemini отдыхают после лимита или сбоя (gemini.ts::ModelRest). Бесплатный лимит Gemini так тратится только на живые разговоры.
import { db } from '../db.ts';
import { settings as constants } from '../settings.ts';
import type { Trigger } from './triggers.ts';

/** ok — можно отвечать; cooldown — этот человек только что получил ответ; quiet — «встрять самой» слишком рано;
 *  hour / day — потолок ответов; paused — все модели Gemini отдыхают после лимита или сбоя (решает index.ts). */
export type Verdict = 'ok' | 'cooldown' | 'quiet' | 'hour' | 'day' | 'paused';

export interface LimitSettings {
  userCooldownSeconds: number;
  perHour: number;
  perDay: number;
}

const HOUR = 60 * 60 * 1000;
/** Сама встревает, только если в канале не отвечала хотя бы столько. */
const RANDOM_QUIET = 10 * 60 * 1000;

/** День по Киеву: «2026-10-19». */
export function dayKey(now: number): string {
  return Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(constants.timeZone).toPlainDate().toString();
}

export function repliesOn(day: string): number {
  const row = db.prepare('SELECT replies FROM sveta_usage WHERE day = ?').get(day) as { replies: number } | undefined;
  return Number(row?.replies ?? 0);
}

function countReply(day: string): void {
  db.prepare('INSERT INTO sveta_usage (day, replies) VALUES (?, 1) ON CONFLICT (day) DO UPDATE SET replies = replies + 1').run(day);
}

/** Запросов к Gemini за день: ответ с инструментами — это 2–3 запроса. Бесплатный лимит Google считает именно их. */
export function requestsOn(day: string): number {
  const row = db.prepare('SELECT requests FROM sveta_usage WHERE day = ?').get(day) as { requests: number } | undefined;
  return Number(row?.requests ?? 0);
}

export function countRequests(day: string, n: number): void {
  db.prepare('INSERT INTO sveta_usage (day, requests) VALUES (?, ?) ON CONFLICT (day) DO UPDATE SET requests = requests + excluded.requests').run(day, n);
}

/** Расход модели: запросы (с неудачными), токены на вход и выход, стоимость в долларах (null — сервис не сообщает). */
export interface Spend {
  requests: number;
  input: number;
  output: number;
  cost: number | null;
}

export const NO_SPEND: Spend = { requests: 0, input: 0, output: 0, cost: null };

/** Сложить расход; стоимость известна, если её прислал хоть один запрос. */
export function addSpend(a: Spend, b: Spend): Spend {
  return { requests: a.requests + b.requests, input: a.input + b.input, output: a.output + b.output, cost: a.cost === null && b.cost === null ? null : (a.cost ?? 0) + (b.cost ?? 0) };
}

export function countSpend(day: string, model: string, spend: Spend): void {
  const row = db.prepare('SELECT requests, input_tokens AS input, output_tokens AS output, cost FROM sveta_model_usage WHERE day = ? AND model = ?').get(day, model) as Spend | undefined;
  const total = addSpend(row ?? NO_SPEND, spend);
  db.prepare('INSERT OR REPLACE INTO sveta_model_usage (day, model, requests, input_tokens, output_tokens, cost) VALUES (?, ?, ?, ?, ?, ?)').run(
    day,
    model,
    total.requests,
    total.input,
    total.output,
    total.cost,
  );
}

/** Расход по дням и моделям начиная с firstDay («2026-10-20»), свежие дни сверху. */
export function spendSince(firstDay: string): ({ day: string; model: string } & Spend)[] {
  return db
    .prepare('SELECT day, model, requests, input_tokens, output_tokens, cost FROM sveta_model_usage WHERE day >= ? ORDER BY day DESC, requests DESC, model')
    .all(firstDay)
    .map((row) => ({
      day: String(row.day),
      model: String(row.model),
      requests: Number(row.requests),
      input: Number(row.input_tokens),
      output: Number(row.output_tokens),
      cost: row.cost === null ? null : Number(row.cost),
    }));
}

export class Limiter {
  private readonly userLast = new Map<string, number>();
  private readonly channelLast = new Map<string, number>();
  private hourly: number[] = [];
  private readonly noticeAt = new Map<string, number>();

  check(trigger: Trigger, userId: string, channelId: string, now: number, limits: LimitSettings): Verdict {
    if (repliesOn(dayKey(now)) >= limits.perDay) return 'day';
    this.hourly = this.hourly.filter((at) => now - at < HOUR);
    if (this.hourly.length >= limits.perHour) return 'hour';
    if (trigger === 'random' && now - (this.channelLast.get(channelId) ?? 0) < RANDOM_QUIET) return 'quiet';
    if (now - (this.userLast.get(userId) ?? 0) < limits.userCooldownSeconds * 1000) return 'cooldown';
    return 'ok';
  }

  /** Отметить ответ — до запроса к модели, чтобы несколько сообщений подряд не проскочили потолок. */
  record(userId: string, channelId: string, now: number): void {
    this.userLast.set(userId, now);
    this.channelLast.set(channelId, now);
    this.hourly.push(now);
    countReply(dayKey(now));
  }

  /** Сказать в канале «я на перерыве» — не чаще раза в час. */
  shouldNotice(channelId: string, now: number): boolean {
    if (now - (this.noticeAt.get(channelId) ?? 0) < HOUR) return false;
    this.noticeAt.set(channelId, now);
    return true;
  }
}

/** Что Света говорит, когда отвечать не может. */
export const BREAK_LINES: Record<'hour' | 'day' | 'paused', string> = {
  hour: 'Дайте Свете передохнуть, через часик вернусь ☕',
  day: 'Всё, на сегодня я выговорилась 😮‍💨 Завтра поболтаем!',
  paused: 'Я на перерыве 💤 Загляну попозже.',
};
