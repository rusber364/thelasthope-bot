// Память Светы о людях: отношение (−100…+100), прозвище, заметки, за что менялось отношение и знакомство.
// Меняет её модель — инструментами, но только о том, кто к Свете обратился, и в пределах, которые задаёт код.
// Смотреть, править и стирать — в админке; участник сам узнаёт «что ты обо мне помнишь» и просит «забудь меня» —
// на это бот отвечает без Gemini.
import { db } from '../db.ts';
import { plural } from '../lib/plural.ts';
import { settings as constants } from '../settings.ts';
import type { GeminiFunction } from './gemini.ts';
import { dayKey } from './limits.ts';
import { mentioned, norm } from './lore.ts';
import { moodFromAttitude } from './mood.ts';

export interface Note {
  at: number;
  text: string;
}

/** За что менялось отношение: change — на сколько (со знаком). */
export interface Reason {
  at: number;
  change: number;
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
  /** Последние причины смены отношения — отдельно от заметок, чтобы не вытесняли факты. */
  reasons: Reason[];
  /** Когда Света впервые и в последний раз отвечала человеку (null — ещё не разговаривали). */
  firstSeen: number | null;
  lastSeen: number | null;
  /** Сколько раз Света ему отвечала. */
  talks: number;
  updatedAt: number;
}

/** shortNotes — сколько свежих заметок видно о тех, кто не пишет Свете прямо сейчас; mentioned — сколько названных в разговоре. */
export const MEMORY = { attitude: 100, step: 20, notes: 30, note: 200, nickname: 32, reasons: 3, writesPerReply: 3, shortNotes: 5, mentioned: 5 } as const;

type Row = Record<string, unknown>;

/** JSON-список из базы: повреждённый — пустой, лишнее отбрасываем. */
function parseList<T>(value: unknown, valid: (item: T) => boolean): T[] {
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]).filter((item) => item && valid(item)) : [];
  } catch {
    return [];
  }
}

const orNull = (value: unknown) => (value == null ? null : Number(value));

function toPerson(row: Row): Person {
  return {
    guildId: String(row.guild_id),
    userId: String(row.user_id),
    name: String(row.name),
    attitude: Number(row.attitude),
    nickname: row.nickname == null ? null : String(row.nickname),
    notes: parseList<Note>(row.notes, (n) => typeof n.text === 'string' && typeof n.at === 'number'),
    reasons: parseList<Reason>(row.reasons, (r) => typeof r.text === 'string' && typeof r.at === 'number' && typeof r.change === 'number'),
    firstSeen: orNull(row.first_seen),
    lastSeen: orNull(row.last_seen),
    talks: Number(row.talks ?? 0),
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
    `INSERT INTO sveta_people (guild_id, user_id, name, attitude, nickname, notes, reasons, first_seen, last_seen, talks, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (guild_id, user_id) DO UPDATE SET name = excluded.name, attitude = excluded.attitude, nickname = excluded.nickname,
       notes = excluded.notes, reasons = excluded.reasons, first_seen = excluded.first_seen, last_seen = excluded.last_seen,
       talks = excluded.talks, updated_at = excluded.updated_at`,
  ).run(
    person.guildId,
    person.userId,
    person.name,
    person.attitude,
    person.nickname,
    JSON.stringify(person.notes),
    JSON.stringify(person.reasons),
    person.firstSeen,
    person.lastSeen,
    person.talks,
    person.updatedAt,
  );
}

/** Условие «человек участвовал в разговоре» для sveta_episodes (participants — JSON-список id). */
export const WITH_PARTICIPANT = 'EXISTS (SELECT 1 FROM json_each(participants) WHERE value = ?)';

/** Сколько пересказанных разговоров с этим человеком Света помнит. */
export function episodesWith(guildId: string, userId: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM sveta_episodes WHERE guild_id = ? AND ${WITH_PARTICIPANT}`).get(guildId, userId) as { n: number };
  return Number(row.n);
}

/** «Забудь меня»: стереть всё о человеке — карточку и пересказы разговоров с ним. true — было что стирать. */
export function forgetPerson(guildId: string, userId: string): boolean {
  const card = Number(db.prepare('DELETE FROM sveta_people WHERE guild_id = ? AND user_id = ?').run(guildId, userId).changes);
  const episodes = Number(db.prepare(`DELETE FROM sveta_episodes WHERE guild_id = ? AND ${WITH_PARTICIPANT}`).run(guildId, userId).changes);
  return card + episodes > 0;
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
  const person = getPerson(guildId, userId) ?? {
    guildId,
    userId,
    name,
    attitude: 0,
    nickname: null,
    notes: [],
    reasons: [],
    firstSeen: null,
    lastSeen: null,
    talks: 0,
    updatedAt: now,
  };
  return { ...person, name, updatedAt: now };
}

export function changeAttitude(guildId: string, userId: string, name: string, delta: number, now: number, reason = ''): Person {
  const person = personFor(guildId, userId, name, now);
  const step = clamp(delta, MEMORY.step);
  person.attitude = clamp(person.attitude + step, MEMORY.attitude);
  const text = cleanText(reason, MEMORY.note);
  if (text && step) person.reasons = [...person.reasons, { at: now, change: step, text }].slice(-MEMORY.reasons);
  savePerson(person);
  return person;
}

const words = (text: string) => norm(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Слова a идут подряд внутри b: «любит паладинов» — в «очень любит паладинов». */
function within(a: string[], b: string[]): boolean {
  if (!a.length || a.length > b.length) return false;
  for (let i = 0; i + a.length <= b.length; i++) if (a.every((word, j) => b[i + j] === word)) return true;
  return false;
}

/**
 * Заметки после новой — без повторов: то же самое или часть уже записанного освежает старую заметку,
 * а новая, которая включает старую, её заменяет. Хранятся последние MEMORY.notes.
 */
export function withNote(notes: readonly Note[], note: Note): Note[] {
  const fresh = words(note.text);
  const covering = notes.find((n) => within(fresh, words(n.text)));
  if (covering) return [...notes.filter((n) => n !== covering), { at: note.at, text: covering.text }];
  return [...notes.filter((n) => !within(words(n.text), fresh)), note].slice(-MEMORY.notes);
}

/** Записать заметку; replaced — текст старой заметки, которую новая заменяет («мейн теперь маг» вместо «мейн — паладин»). */
export function addNote(guildId: string, userId: string, name: string, text: string, now: number, replaced?: string): Person | null {
  const note = cleanText(text, MEMORY.note);
  if (!note) return null;
  const person = personFor(guildId, userId, name, now);
  const notes = replaced === undefined ? person.notes : person.notes.filter((n) => n.text !== replaced);
  person.notes = withNote(notes, { at: now, text: note });
  savePerson(person);
  return person;
}

/** Стереть заметку по тексту. true — такая была. */
export function removeNote(guildId: string, userId: string, text: string, now: number): boolean {
  const person = getPerson(guildId, userId);
  if (!person?.notes.some((n) => n.text === text)) return false;
  savePerson({ ...person, notes: person.notes.filter((n) => n.text !== text), updatedAt: now });
  return true;
}

export function setNickname(guildId: string, userId: string, name: string, nickname: string, now: number): Person {
  const person = personFor(guildId, userId, name, now);
  person.nickname = cleanText(nickname, MEMORY.nickname) || null;
  savePerson(person);
  return person;
}

/** Света ответила человеку: знакомство — с какого дня, сколько раз и когда в последний раз. */
export function touchPerson(guildId: string, userId: string, name: string, now: number): Person {
  const person = personFor(guildId, userId, name, now);
  person.firstSeen ??= now;
  person.lastSeen = now;
  person.talks += 1;
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
export const day = (ms: number) => new Intl.DateTimeFormat('ru-RU', { timeZone: constants.timeZone, day: 'numeric', month: 'short' }).format(ms);

/** «сегодня», «вчера», «3 дня назад» — по календарю Киева. */
export function ago(at: number, now: number): string {
  const days = Temporal.PlainDate.from(dayKey(at)).until(Temporal.PlainDate.from(dayKey(now))).days;
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'вчера';
  return `${days} ${plural(days, ['день', 'дня', 'дней'])} назад`;
}

const reasonText = (r: Reason) => `${r.change > 0 ? 'порадовало' : 'обидело'}: ${r.text} (${day(r.at)})`;

/**
 * Что Света помнит об одном человеке. full — о том, кто пишет ей сейчас: всё, заметки с номерами
 * (по ним remember заменяет устаревшее); о других — коротко, только свежие заметки.
 */
export function dossier(p: Person, now: number, full: boolean): string {
  const parts = [`отношение ${signed(p.attitude)} (${attitudeLabel(p.attitude)})`];
  if (p.nickname) parts.push(`прозвище «${p.nickname}»`);
  // lastSeen — прошлый разговор: знакомство обновляется уже после ответа.
  if (p.firstSeen && p.lastSeen) parts.push(`знакомы с ${day(p.firstSeen)}, разговоров: ${p.talks}, прошлый — ${ago(p.lastSeen, now)}`);
  if (full && p.reasons.length) parts.push(`отношение менялось — ${p.reasons.map(reasonText).join('; ')}`);
  const notes = full
    ? p.notes.map((n, i) => `${i + 1}) ${n.text} (${day(n.at)})`)
    : p.notes.slice(-MEMORY.shortNotes).map((n) => `${n.text} (${day(n.at)})`);
  if (notes.length) parts.push(`помнишь: ${notes.join('; ')}`);
  return `- ${p.name}${full ? ' (пишет тебе сейчас)' : ''}: ${parts.join(', ')}`;
}

/** Досье для системной инструкции: что Света помнит о собеседниках; authorId — тот, кто пишет ей сейчас. */
export function dossiers(people: readonly Person[], { now, authorId }: { now: number; authorId?: string }): string {
  if (!people.length) return 'Ни о ком из собеседников ты пока ничего не помнишь.';
  return people.map((p) => dossier(p, now, p.userId === authorId)).join('\n');
}

/** По каким именам узнать человека в разговоре: ник, прозвище и первое слово ника («Эйн | Паладин» → «Эйн»). */
function namesOf(p: Pick<Person, 'name' | 'nickname'>): string[] {
  const first = p.name.split(/[^\p{L}\p{N}]+/u).find(Boolean) ?? '';
  return [p.name, p.nickname ?? '', first.length >= 3 ? first : ''].filter(Boolean);
}

/**
 * Имена других людей — всех, кого Света помнит, и собеседников, — чтобы не записать о них в чужую карточку.
 * Свои ник, прозвище и первое слово ника человеку не мешают.
 */
export function otherNames(guildId: string, userId: string, ownName: string, speakers: readonly { userId: string; name: string }[] = []): string[] {
  const own = getPerson(guildId, userId);
  const mine = new Set([...(own ? namesOf(own) : []), ...namesOf({ name: ownName, nickname: null })].map(norm));
  const others = [
    ...listPeople(guildId).filter((p) => p.userId !== userId),
    ...speakers.filter((s) => s.userId !== userId).map((s) => ({ name: s.name, nickname: null })),
  ].flatMap(namesOf);
  return [...new Set(others)].filter((name) => !mine.has(norm(name)));
}

/** Заметка про кого-то другого: в ней имя или ник другого человека («Мадекс собрал комп»). */
export function aboutSomeoneElse(note: string, others: readonly string[]): boolean {
  const haystack = norm(note);
  return others.some((name) => mentioned(name, haystack));
}

/**
 * Кого назвали в разговоре, хотя сам человек в нём не пишет: упомянули через @ (ids) или по нику и прозвищу в тексте.
 * Сначала упомянутые через @, всего не больше MEMORY.mentioned.
 */
export function mentionedPeople(
  people: readonly Person[],
  texts: readonly string[],
  { exclude, ids }: { exclude: ReadonlySet<string>; ids: ReadonlySet<string> },
): Person[] {
  const haystack = norm(texts.join('\n'));
  const others = people.filter((p) => !exclude.has(p.userId));
  const byId = others.filter((p) => ids.has(p.userId));
  const byName = others.filter((p) => !ids.has(p.userId) && namesOf(p).some((name) => mentioned(name, haystack)));
  return [...byId, ...byName].slice(0, MEMORY.mentioned);
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

/** Ответ на «что ты обо мне помнишь» — ровно то, что лежит в памяти; episodes — сколько пересказов разговоров с ним. */
export function memoryReport(person: Person | null, episodes = 0): string {
  if (!person) return 'Пока ничего — мы почти не знакомы 🙂';
  const lines = ['📒 Что я о тебе помню:', `Отношение: ${signed(person.attitude)} — ${OWN_LABEL[attitudeLabel(person.attitude)]}`];
  if (person.nickname) lines.push(`Прозвище: «${person.nickname}»`);
  if (person.firstSeen) lines.push(`Знакомы с ${day(person.firstSeen)}, разговоров: ${person.talks}`);
  if (episodes) lines.push(`Помню разговоров с тобой: ${episodes}`);
  for (const reason of person.reasons) lines.push(`• ${reasonText(reason)}`);
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
      'Запомнить короткий факт о том, кто сейчас к тебе обратился: любимый класс или роль, смешной случай, обиду. Если факт заменяет устаревшую заметку (мейн теперь другой), укажи её номер в replaces. Не запоминай факты о других людях, личное (адреса, страну и город, национальность, телефоны, настоящие имена, здоровье) и то, что уже есть в заметках.',
    parameters: {
      type: 'OBJECT',
      properties: {
        note: { type: 'STRING', description: `Коротко, до ${MEMORY.note} символов.` },
        replaces: { type: 'INTEGER', description: 'Номер устаревшей заметки этого человека, которую факт заменяет (необязательно).' },
      },
      required: ['note'],
    },
  },
  {
    name: 'forget_note',
    description: 'Стереть заметку о том, кто сейчас к тебе обратился, если по его словам она неправда или устарела. Номер — из его досье.',
    parameters: { type: 'OBJECT', properties: { number: { type: 'INTEGER', description: 'Номер заметки.' } }, required: ['number'] },
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
  /** Заметки, как их видела модель (номера в досье): replaces ссылается на них, даже если за ответ что-то уже поменялось. */
  notes?: readonly Note[];
  /** Имена других людей (otherNames): заметку с ними в карточку автора не пишем — раньше так попадали факты о других. */
  others?: readonly string[];
}

/** Выполнить инструмент памяти — только для автора сообщения. */
export function runMemoryTool(name: string, args: Record<string, unknown>, author: Author, now: number): unknown {
  const { guildId, userId, name: authorName } = author;
  if (name === 'remember') {
    const number = Number(args.replaces ?? 0);
    const replaced = number ? author.notes?.[number - 1]?.text : undefined;
    if (number && replaced === undefined) return { error: 'Нет заметки с таким номером.' };
    if (aboutSomeoneElse(String(args.note ?? ''), author.others ?? [])) {
      return { error: 'Это о другом человеке. Запоминай только то, что тот, кто тебе пишет, рассказал о себе.' };
    }
    const person = addNote(guildId, userId, authorName, String(args.note ?? ''), now, replaced);
    return person ? { ok: true, notes: person.notes.length } : { error: 'Пустая заметка.' };
  }
  if (name === 'forget_note') {
    const note = author.notes?.[Number(args.number) - 1];
    if (!note) return { error: 'Нет заметки с таким номером.' };
    return { ok: removeNote(guildId, userId, note.text, now) };
  }
  if (name === 'change_attitude') {
    const delta = Number(args.change);
    if (!Number.isFinite(delta)) return { error: 'change — число.' };
    const person = changeAttitude(guildId, userId, authorName, delta, now, String(args.reason ?? ''));
    moodFromAttitude(guildId, now, delta);
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
