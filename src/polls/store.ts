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

export function createPoll(guildId: string, channelId: string, definition: PollDefinition, createdBy: string): StoredPoll {
  const row = db
    .prepare('INSERT INTO polls (guild_id, channel_id, definition, created_by, created_at) VALUES (?, ?, ?, ?, ?) RETURNING *')
    .get(guildId, channelId, JSON.stringify(definition), createdBy, Date.now());
  return toPoll(row as Row);
}

export function deletePoll(id: number): void {
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
}

export function listResponses(pollId: number): PollResponse[] {
  return db
    .prepare('SELECT * FROM poll_responses WHERE poll_id = ? ORDER BY updated_at')
    .all(pollId)
    .map((row) => toResponse(row as Row));
}
