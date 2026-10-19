// Память Светы о людях: отношение (−100…+100), прозвище и короткие заметки. Меняет её модель — инструментами, но
// только о том, кто к Свете обратился, и в пределах, которые задаёт код. Смотреть, править и стирать — в админке;
// участник сам узнаёт «что ты обо мне помнишь» и просит «забудь меня» — на это бот отвечает без Gemini.
import { db } from '../db.ts';
import { settings as constants } from '../settings.ts';
import type { GeminiFunction } from './gemini.ts';

export interface Note {
  at: number;
  text: string;
}

export interface Person {
  guildId: string;
  userId: string;
  /** Последний ник — чтобы в админке было понятно, кто это. */
  name: string;
  attitude: number;
  nickname: string | null;
  notes: Note[];
  updatedAt: number;
}

export const MEMORY = { attitude: 100, step: 20, notes: 10, note: 200, nickname: 32, writesPerReply: 3 } as const;

type Row = Record<string, unknown>;

function toPerson(row: Row): Person {
  let notes: Note[] = [];
  try {
    const parsed = JSON.parse(String(row.notes)) as unknown;
    if (Array.isArray(parsed)) notes = parsed.filter((n): n is Note => typeof n?.text === 'string' && typeof n?.at === 'number');
  } catch {
    // повреждённые заметки — просто без них
  }
  return {
    guildId: String(row.guild_id),
    userId: String(row.user_id),
    name: String(row.name),
    attitude: Number(row.attitude),
    nickname: row.nickname == null ? null : String(row.nickname),
    notes,
    updatedAt: Number(row.updated_at),
  };
}

export function getPerson(guildId: string, userId: string): Person | null {
  const row = db.prepare('SELECT * FROM sveta_people WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  return row ? toPerson(row as Row) : null;
}

export function listPeople(guildId: string): Person[] {
  return db
    .prepare('SELECT * FROM sveta_people WHERE guild_id = ? ORDER BY updated_at DESC')
    .all(guildId)
    .map((row) => toPerson(row as Row));
}

export function savePerson(person: Person): void {
  db.prepare(
    `INSERT INTO sveta_people (guild_id, user_id, name, attitude, nickname, notes, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (guild_id, user_id) DO UPDATE SET name = excluded.name, attitude = excluded.attitude, nickname = excluded.nickname,
       notes = excluded.notes, updated_at = excluded.updated_at`,
  ).run(person.guildId, person.userId, person.name, person.attitude, person.nickname, JSON.stringify(person.notes), person.updatedAt);
}

/** «Забудь меня»: стереть всё о человеке. true — было что стирать. */
export function forgetPerson(guildId: string, userId: string): boolean {
  return Number(db.prepare('DELETE FROM sveta_people WHERE guild_id = ? AND user_id = ?').run(guildId, userId).changes) > 0;
}

/** Текст из модели или админки: одна строка, без упоминаний, не длиннее max. */
export function cleanText(text: string, max: number): string {
  const clean = text
    .replace(/<@[!&]?\d+>|<#\d+>/g, '')
    .replace(/@(everyone|here)/gi, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

const clamp = (n: number, limit: number) => Math.max(-limit, Math.min(limit, Math.round(n)));

/** Человек, к которому относится запись: то, что уже помним, или новая карточка. */
function personFor(guildId: string, userId: string, name: string, now: number): Person {
  const person = getPerson(guildId, userId) ?? { guildId, userId, name, attitude: 0, nickname: null, notes: [], updatedAt: now };
  return { ...person, name, updatedAt: now };
}

export function changeAttitude(guildId: string, userId: string, name: string, delta: number, now: number): Person {
  const person = personFor(guildId, userId, name, now);
  person.attitude = clamp(person.attitude + clamp(delta, MEMORY.step), MEMORY.attitude);
  savePerson(person);
  return person;
}

export function addNote(guildId: string, userId: string, name: string, text: string, now: number): Person | null {
  const note = cleanText(text, MEMORY.note);
  if (!note) return null;
  const person = personFor(guildId, userId, name, now);
  person.notes = [...person.notes, { at: now, text: note }].slice(-MEMORY.notes);
  savePerson(person);
  return person;
}

export function setNickname(guildId: string, userId: string, name: string, nickname: string, now: number): Person {
  const person = personFor(guildId, userId, name, now);
  person.nickname = cleanText(nickname, MEMORY.nickname) || null;
  savePerson(person);
  return person;
}

/** Отношение словами — от лица Светы. */
export function attitudeLabel(attitude: number): string {
  if (attitude <= -60) return 'терпеть не может';
  if (attitude <= -20) return 'недолюбливает';
  if (attitude < 20) return 'нейтрально';
  if (attitude < 60) return 'симпатизирует';
  return 'обожает';
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
const day = (ms: number) => new Intl.DateTimeFormat('ru-RU', { timeZone: constants.timeZone, day: 'numeric', month: 'short' }).format(ms);

/** Досье для системной инструкции: что Света помнит о собеседниках. */
export function dossiers(people: Person[]): string {
  if (!people.length) return 'Ни о ком из собеседников ты пока ничего не помнишь.';
  return people
    .map((p) => {
      const parts = [`отношение ${signed(p.attitude)} (${attitudeLabel(p.attitude)})`];
      if (p.nickname) parts.push(`прозвище «${p.nickname}»`);
      if (p.notes.length) parts.push(`помнишь: ${p.notes.map((n) => `${n.text} (${day(n.at)})`).join('; ')}`);
      return `- ${p.name}: ${parts.join(', ')}`;
    })
    .join('\n');
}

// --- «Что ты обо мне помнишь» и «забудь меня»: отвечает код, точно и без запроса к Gemini ---

const ABOUT_ME = '(?:обо\\s+мне|об\\s+мне|про\\s+меня)';
const ASK = new RegExp(`что\\s+(?:ты\\s+)?(?:${ABOUT_ME}\\s+(?:помнишь|знаешь)|(?:помнишь|знаешь)\\s+${ABOUT_ME})`, 'i');
const FORGET = new RegExp(`забудь\\s+(?:меня|(?:вс[её]\\s+)?${ABOUT_ME})`, 'i');

export type MemoryCommand = 'ask' | 'forget';

export function memoryCommand(text: string): MemoryCommand | null {
  if (FORGET.test(text)) return 'forget';
  if (ASK.test(text)) return 'ask';
  return null;
}

const OWN_LABEL: Record<string, string> = {
  'терпеть не может': 'терпеть не могу 😤',
  недолюбливает: 'недолюбливаю 😒',
  нейтрально: 'нейтрально 🙂',
  симпатизирует: 'симпатизирую 😊',
  обожает: 'обожаю 🥰',
};

/** Ответ на «что ты обо мне помнишь» — ровно то, что лежит в памяти. */
export function memoryReport(person: Person | null): string {
  if (!person) return 'Пока ничего — мы почти не знакомы 🙂';
  const lines = ['📒 Что я о тебе помню:', `Отношение: ${signed(person.attitude)} — ${OWN_LABEL[attitudeLabel(person.attitude)]}`];
  if (person.nickname) lines.push(`Прозвище: «${person.nickname}»`);
  for (const note of person.notes) lines.push(`• ${day(note.at)}: ${note.text}`);
  lines.push('-# Стереть всё — напиши «Света, забудь меня».');
  return lines.join('\n');
}

export const FORGOTTEN = 'Всё, забыла 🙈 Начинаем с чистого листа.';
export const NOTHING_TO_FORGET = 'А я о тебе ничего и не помню 🙂';

// --- Инструменты памяти: всегда о том, кто обратился к Свете ---

export const MEMORY_TOOLS: GeminiFunction[] = [
  {
    name: 'remember',
    description:
      'Запомнить короткий факт о том, кто сейчас к тебе обратился: любимый класс или роль, смешной случай, обиду. Не запоминай личное (адреса, телефоны, настоящие имена, здоровье).',
    parameters: { type: 'OBJECT', properties: { note: { type: 'STRING', description: 'Коротко, до 200 символов.' } }, required: ['note'] },
  },
  {
    name: 'change_attitude',
    description: `Поменять твоё отношение к тому, кто сейчас к тебе обратился: минус — задели, оскорбили, издеваются; плюс — извинились, похвалили, помогли. Шаг от −${MEMORY.step} до +${MEMORY.step}.`,
    parameters: {
      type: 'OBJECT',
      properties: { change: { type: 'INTEGER', description: `От −${MEMORY.step} до ${MEMORY.step}.` }, reason: { type: 'STRING', description: 'За что, коротко.' } },
      required: ['change', 'reason'],
    },
  },
  {
    name: 'set_nickname',
    description: 'Дать или поменять беззлобное прозвище тому, кто сейчас к тебе обратился.',
    parameters: { type: 'OBJECT', properties: { nickname: { type: 'STRING', description: `До ${MEMORY.nickname} символов.` } }, required: ['nickname'] },
  },
];

export const MEMORY_TOOL_NAMES = new Set(MEMORY_TOOLS.map((tool) => tool.name));

export interface Author {
  guildId: string;
  userId: string;
  name: string;
}

/** Выполнить инструмент памяти — только для автора сообщения. */
export function runMemoryTool(name: string, args: Record<string, unknown>, author: Author, now: number): unknown {
  const { guildId, userId, name: authorName } = author;
  if (name === 'remember') {
    const person = addNote(guildId, userId, authorName, String(args.note ?? ''), now);
    return person ? { ok: true, notes: person.notes.length } : { error: 'Пустая заметка.' };
  }
  if (name === 'change_attitude') {
    const delta = Number(args.change);
    if (!Number.isFinite(delta)) return { error: 'change — число.' };
    const person = changeAttitude(guildId, userId, authorName, delta, now);
    const reason = cleanText(String(args.reason ?? ''), MEMORY.note);
    if (reason && Math.abs(delta) >= 10) addNote(guildId, userId, authorName, `${delta > 0 ? 'порадовало' : 'обидело'}: ${reason}`, now);
    return { ok: true, attitude: person.attitude };
  }
  if (name === 'set_nickname') {
    const person = setNickname(guildId, userId, authorName, String(args.nickname ?? ''), now);
    return { ok: true, nickname: person.nickname };
  }
  return { error: `Нет такого инструмента: ${name}.` };
}

/** Проверка правки из админки (чистая функция). */
export function personInput(body: Record<string, unknown>): { errors: string[]; attitude: number; nickname: string | null; notes: string[] } {
  const errors: string[] = [];
  const attitude = Number(body.attitude);
  if (!Number.isInteger(attitude) || Math.abs(attitude) > MEMORY.attitude) errors.push(`Отношение — целое число от −${MEMORY.attitude} до ${MEMORY.attitude}.`);
  const nickname = typeof body.nickname === 'string' ? cleanText(body.nickname, MEMORY.nickname + 1) : '';
  if (nickname.length > MEMORY.nickname) errors.push(`Прозвище — не длиннее ${MEMORY.nickname} символов.`);
  const notes = (Array.isArray(body.notes) ? body.notes : []).map((n) => (typeof n === 'string' ? cleanText(n, MEMORY.note + 1) : '')).filter(Boolean);
  if (notes.length > MEMORY.notes) errors.push(`Заметок — не больше ${MEMORY.notes}.`);
  if (notes.some((n) => n.length > MEMORY.note)) errors.push(`Заметка — не длиннее ${MEMORY.note} символов.`);
  return { errors, attitude, nickname: nickname || null, notes };
}
