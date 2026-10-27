// Манеры Светы — чтобы звучала как человек, а не бот: не повторяет свои междометия и эмодзи, иногда отвечает одной
// фразой, на «спасибо» и смех ставит реакцию вместо текста, отстаёт от того, кто попросил, и «печатает» не мгновенно.
// По октябрьской переписке на главном 40% её ответов начинались с «Ой», 😉 стоял в каждом третьем, а коротких почти не было.
import { norm } from './lore.ts';

/** Междометия, с которых она любит начинать. Имя собеседника в начале — не привычка. */
const INTERJECTIONS = new Set(['ой', 'ох', 'ах', 'эх', 'ну', 'о', 'ого', 'ага', 'хм', 'мм', 'ха', 'ахах', 'ой-ой', 'ну-ну', 'ох-ох', 'ах-ах']);
/** Действие в звёздочках в начале реплики: «*Хмыкаю, протирая стакан*». */
const ACTION = /^\s*\*[^*\n]{1,200}\*\s*/;
const EMOJI = /\p{Extended_Pictographic}️?/gu;

/** Междометие в начале реплики (после действия в звёздочках) или null. */
export function opener(text: string): string | null {
  const word = /^[\p{L}-]+/u.exec(text.replace(ACTION, '').trimStart())?.[0];
  const key = word ? norm(word) : '';
  return INTERJECTIONS.has(key) ? key : null;
}

export interface Habits {
  openers: string[];
  emoji: string[];
}

/**
 * Её привычки по последним репликам (свежие — в конце): междометие, с которого начиналась последняя реплика,
 * и междометия и эмодзи, повторённые хотя бы дважды.
 */
export function speechHabits(replies: readonly string[], last = 8): Habits {
  const recent = replies.slice(-last);
  const twice = (items: string[]) => [...Map.groupBy(items, (item) => item)].filter(([, all]) => all.length >= 2).map(([item]) => item);
  const openers = recent.map(opener).filter((word): word is string => word !== null);
  const lastOpener = recent.length ? opener(recent.at(-1)!) : null;
  return {
    openers: [...new Set([...(lastOpener ? [lastOpener] : []), ...twice(openers)])],
    emoji: twice(recent.flatMap((reply) => [...new Set(reply.match(EMOJI) ?? [])])),
  };
}

const quoted = (word: string) => `«${word.charAt(0).toUpperCase()}${word.slice(1)}»`;

/** Строка для инструкции; пусто — повторов нет. */
export function habitsText(habits: Habits): string {
  const parts = [
    habits.openers.length ? `не начинай с ${habits.openers.map(quoted).join(', ')}` : '',
    habits.emoji.length ? `обойдись без ${habits.emoji.join(' ')}` : '',
  ].filter(Boolean);
  return parts.length ? `Не повторяй свою манеру из последних ответов: ${parts.join(' и ')}.` : '';
}

/** Ответ без её привычек: повторённое междометие в начале и повторённые эмодзи код убирает, даже если модель не послушалась. */
export function withoutHabits(text: string, habits: Habits): string {
  let result = text;
  const action = ACTION.exec(result)?.[0] ?? '';
  const rest = result.slice(action.length);
  const word = opener(rest);
  const after = rest.replace(/^\s*[\p{L}-]+[\s,!.…]*/u, '');
  if (word && habits.openers.includes(word) && after) result = action + after.charAt(0).toUpperCase() + after.slice(1);
  for (const emoji of habits.emoji) result = result.replaceAll(emoji, '');
  return result.replace(/[ \t]{2,}/g, ' ').replace(/ +([,.!?…])/g, '$1').trim() || text;
}

/** Какая доля ответов — одной короткой фразой (решает случай). */
export const BRIEF_SHARE = 0.35;

// --- Реакция вместо слов ---

const NAME = /(?<![\p{L}])(?:света|светик|светочка|светка|светуля|светлана|светланка|свет)(?![\p{L}])/gu;
const CUSTOM_EMOJI = /<a?:\w+:\d+>/g;
const MENTION = /<@[!&]?\d+>|@\S+/g;
const FILLERS = new Set(['ну', 'большое', 'огромное', 'тебе', 'вам', 'очень', 'да', 'и', 'всё', 'все', 'ладно']);
const KINDS: [RegExp, string][] = [
  [/^(спасибо|спасиб|спс|пасиб\p{L}*|благодарю|сенкс|мерси|thx|thanks|ty)$/u, '❤️'],
  [/^(а?(ха|хе|хи)+\p{L}*|ах+а\p{L}*|лол|кек|ору|хд|xd|lol|kek|rofl|ахах\p{L}*)$/u, '😂'],
  [/^(ок|окей|окс|ok|okay|понял|поняла|понятно|ясно|ага|угу|принято|лады|хорошо|договорились|\++)$/u, '👍'],
];

/**
 * Реакция вместо ответа: «спасибо» — ❤️, смех — 😂, «ок» — 👍, только эмодзи или стикер — 😊. Её имя и упоминания
 * не в счёт; что-то сверх этого («спасибо, а когда рейд?») — null, нужен ответ словами.
 */
export function reactionFor(content: string, stickers: number): string | null {
  const text = norm(content).replace(CUSTOM_EMOJI, ' ').replace(MENTION, ' ').replace(NAME, ' ');
  const words = text
    .replace(EMOJI, ' ')
    .replace(/[^\p{L}\p{N}+]+/gu, ' ')
    .trim()
    .split(' ')
    .filter((word) => word && !FILLERS.has(word));
  if (!words.length) {
    const hadEmoji = Boolean(content.match(EMOJI) ?? content.match(CUSTOM_EMOJI));
    return stickers || hadEmoji ? '😊' : null;
  }
  if (words.length > 3) return null;
  return KINDS.find(([pattern]) => words.every((word) => pattern.test(word)))?.[1] ?? null;
}

// --- «Отстань» ---

const QUIET = /(?<![\p{L}])(?:утихни|отстань|отвали|отвянь|замолчи|заткнись|помолчи|угомонись|задолбала|достала|не лезь)(?![\p{L}])/u;

/** Просит отстать (сообщение обращено к Свете). */
export const quietRequest = (content: string) => QUIET.test(norm(content));

/** Коротко «отстань» без вопроса — хватит реакции, слова не нужны. */
export const shortQuietRequest = (content: string) =>
  quietRequest(content) && !content.includes('?') && norm(content).replace(MENTION, '').replace(NAME, '').trim().length <= 30;

/** Сколько она не встревает к тому, кто попросил отстать, и отвечает ему коротко. */
export const QUIET_MS = 2 * 60 * 60 * 1000;

export class QuietTimer {
  private readonly until = new Map<string, number>();

  ask(key: string, now: number): void {
    this.until.set(key, now + QUIET_MS);
  }

  active(key: string, now: number): boolean {
    return (this.until.get(key) ?? 0) > now;
  }
}

// --- «Печатает…» ---

/** Сколько «печатать» ответ такой длины (часть этого времени уже ушла на модель). */
export const typingMs = (length: number) => Math.min(4000, 400 + length * 15);
