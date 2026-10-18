// Опросы и ответы в базе данных.
import { db } from '../db.ts';
import { emptyState, type PollDefinition, type PollState } from './format.ts';

export interface StoredPoll {
  id: number;
  guildId: string;
  channelId: string;
  messageId: string | null;
  definition: PollDefinition;
  createdBy: string;
  createdAt: number;
  closed: boolean;
  /** Исходный текст опроса (у опросов из старых версий бота — null). */
  source: string | null;
}

export interface PollResponse {
  userId: string;
  state: PollState;
  completedAt: number | null;
  updatedAt: number;
}

type Row = Record<string, unknown>;

function toPoll(row: Row): StoredPoll {
  return {
    id: Number(row.id),
    guildId: String(row.guild_id),
    channelId: String(row.channel_id),
    messageId: row.message_id == null ? null : String(row.message_id),
    definition: JSON.parse(String(row.definition)) as PollDefinition,
    createdBy: String(row.created_by),
    createdAt: Number(row.created_at),
    closed: Boolean(row.closed),
    source: row.source == null ? null : String(row.source),
  };
}

function toResponse(row: Row): PollResponse {
  return {
    userId: String(row.user_id),
    state: { ...emptyState(), ...(JSON.parse(String(row.answers)) as Partial<PollState>) },
    completedAt: row.completed_at == null ? null : Number(row.completed_at),
    updatedAt: Number(row.updated_at),
  };
}

export function createPoll(guildId: string, channelId: string, definition: PollDefinition, createdBy: string, source: string | null = null): StoredPoll {
  const row = db
    .prepare('INSERT INTO polls (guild_id, channel_id, definition, created_by, created_at, source) VALUES (?, ?, ?, ?, ?, ?) RETURNING *')
    .get(guildId, channelId, JSON.stringify(definition), createdBy, Date.now(), source);
  return toPoll(row as Row);
}

export function deletePoll(id: number): void {
  db.prepare('DELETE FROM poll_files WHERE poll_id = ?').run(id);
  db.prepare('DELETE FROM polls WHERE id = ?').run(id);
}

export function setPollMessage(id: number, messageId: string): void {
  db.prepare('UPDATE polls SET message_id = ? WHERE id = ?').run(messageId, id);
}

export function closePoll(id: number): void {
  db.prepare('UPDATE polls SET closed = 1 WHERE id = ?').run(id);
}

export function getPoll(id: number): StoredPoll | null {
  const row = db.prepare('SELECT * FROM polls WHERE id = ?').get(id);
  return row ? toPoll(row as Row) : null;
}

export function listPolls(guildId: string, limit = 25): StoredPoll[] {
  return db
    .prepare('SELECT * FROM polls WHERE guild_id = ? ORDER BY id DESC LIMIT ?')
    .all(guildId, limit)
    .map((row) => toPoll(row as Row));
}

export function getResponse(pollId: number, userId: string): PollResponse | null {
  const row = db.prepare('SELECT * FROM poll_responses WHERE poll_id = ? AND user_id = ?').get(pollId, userId);
  return row ? toResponse(row as Row) : null;
}

export function saveResponse(pollId: number, userId: string, state: PollState, completed: boolean): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO poll_responses (poll_id, user_id, answers, completed_at, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (poll_id, user_id) DO UPDATE SET answers = excluded.answers, completed_at = excluded.completed_at, updated_at = excluded.updated_at`,
  ).run(pollId, userId, JSON.stringify(state), completed ? now : null, now);
}

export function resetResponse(pollId: number, userId: string): void {
  db.prepare('DELETE FROM poll_responses WHERE poll_id = ? AND user_id = ?').run(pollId, userId);
  deletePollFiles(pollId, userId);
}

/** Картинка из ответа на опрос. */
export interface PollFile {
  id: number;
  pollId: number;
  userId: string;
  questionId: string;
  name: string;
  contentType: string;
  data: Uint8Array;
}

/** Сохранить картинку-ответ; прежняя картинка этого человека на этот вопрос удаляется. Возвращает id. */
export function savePollFile(file: Omit<PollFile, 'id'>): number {
  deletePollFiles(file.pollId, file.userId, file.questionId);
  const row = db
    .prepare('INSERT INTO poll_files (poll_id, user_id, question_id, name, content_type, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id')
    .get(file.pollId, file.userId, file.questionId, file.name, file.contentType, file.data, Date.now()) as { id: number };
  return Number(row.id);
}

/** Удалить картинки человека в опросе: на один вопрос или на все. */
export function deletePollFiles(pollId: number, userId: string, questionId?: string): void {
  if (questionId) db.prepare('DELETE FROM poll_files WHERE poll_id = ? AND user_id = ? AND question_id = ?').run(pollId, userId, questionId);
  else db.prepare('DELETE FROM poll_files WHERE poll_id = ? AND user_id = ?').run(pollId, userId);
}

export function getPollFile(id: number): PollFile | null {
  const row = db.prepare('SELECT * FROM poll_files WHERE id = ?').get(id) as Row | undefined;
  if (!row) return null;
  return {
    id: Number(row.id),
    pollId: Number(row.poll_id),
    userId: String(row.user_id),
    questionId: String(row.question_id),
    name: String(row.name),
    contentType: String(row.content_type),
    data: row.data as Uint8Array,
  };
}

/** Сколько человек начали опрос (total) и сколько из них дошли до конца (completed). */
export function countResponses(pollId: number): { total: number; completed: number } {
  const row = db
    .prepare('SELECT COUNT(*) AS total, COUNT(completed_at) AS completed FROM poll_responses WHERE poll_id = ?')
    .get(pollId) as { total: number; completed: number };
  return { total: Number(row.total), completed: Number(row.completed) };
}

export function listResponses(pollId: number): PollResponse[] {
  return db
    .prepare('SELECT * FROM poll_responses WHERE poll_id = ? ORDER BY updated_at')
    .all(pollId)
    .map((row) => toResponse(row as Row));
}
