// Черновики рег, которые офицер создаёт по шагам в личке. Один черновик на человека;
// хранится в базе, поэтому переживает перезапуск бота.
import { db } from '../db.ts';
import type { RaidImage } from './store.ts';

export type DraftStep = 'title' | 'description' | 'date' | 'time' | 'image' | 'confirm';

export interface RaidDraft {
  userId: string;
  guildId: string;
  channelId: string;
  pingRoleId: string | null;
  size: number;
  leaderName: string | null;
  step: DraftStep;
  title: string | null;
  description: string | null;
  /** Дата ГГГГ-ММ-ДД. */
  date: string | null;
  /** Время ЧЧ:ММ. */
  time: string | null;
  image: RaidImage | null;
  /** Уже был предпросмотр: после ответа на шаг возвращаемся к нему, а не идём дальше по порядку. */
  editing: boolean;
  /** Последнее сообщение бота с кнопками — у него кнопки убираются, когда шаг пройден. */
  promptMessageId: string | null;
  updatedAt: number;
}

/** Черновик без действий дольше этого срока считается брошенным. */
export const DRAFT_TTL_MS = 2 * 60 * 60 * 1000;

type Row = Record<string, unknown>;
const text = (value: unknown) => (value == null ? null : String(value));

function toDraft(row: Row): RaidDraft {
  return {
    userId: String(row.user_id),
    guildId: String(row.guild_id),
    channelId: String(row.channel_id),
    pingRoleId: text(row.ping_role_id),
    size: Number(row.size),
    leaderName: text(row.leader_name),
    step: String(row.step) as DraftStep,
    title: text(row.title),
    description: text(row.description),
    date: text(row.date),
    time: text(row.time),
    image: row.image == null ? null : { name: String(row.image_name), data: Buffer.from(row.image as Uint8Array) },
    editing: Boolean(row.editing),
    promptMessageId: text(row.prompt_message_id),
    updatedAt: Number(row.updated_at),
  };
}

export function getDraft(userId: string): RaidDraft | null {
  const row = db.prepare('SELECT * FROM raid_drafts WHERE user_id = ?').get(userId);
  return row ? toDraft(row as Row) : null;
}

export function isExpired(draft: RaidDraft, now = Date.now()): boolean {
  return now - draft.updatedAt > DRAFT_TTL_MS;
}

/** Сохранить черновик целиком (время изменения — сейчас). */
export function saveDraft(draft: RaidDraft): RaidDraft {
  const saved = { ...draft, updatedAt: Date.now() };
  db.prepare(
    `INSERT INTO raid_drafts (user_id, guild_id, channel_id, ping_role_id, size, leader_name, step, title, description, date, time, image, image_name, editing, prompt_message_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET
       guild_id = excluded.guild_id, channel_id = excluded.channel_id, ping_role_id = excluded.ping_role_id, size = excluded.size,
       leader_name = excluded.leader_name, step = excluded.step, title = excluded.title, description = excluded.description,
       date = excluded.date, time = excluded.time, image = excluded.image, image_name = excluded.image_name,
       editing = excluded.editing, prompt_message_id = excluded.prompt_message_id, updated_at = excluded.updated_at`,
  ).run(
    saved.userId,
    saved.guildId,
    saved.channelId,
    saved.pingRoleId,
    saved.size,
    saved.leaderName,
    saved.step,
    saved.title,
    saved.description,
    saved.date,
    saved.time,
    saved.image?.data ?? null,
    saved.image?.name ?? null,
    saved.editing ? 1 : 0,
    saved.promptMessageId,
    saved.updatedAt,
  );
  return saved;
}

export function deleteDraft(userId: string): void {
  db.prepare('DELETE FROM raid_drafts WHERE user_id = ?').run(userId);
}

/** Удалить брошенные черновики (вместе с картинками — чтобы база не росла). */
export function purgeExpiredDrafts(now = Date.now()): void {
  db.prepare('DELETE FROM raid_drafts WHERE updated_at < ?').run(now - DRAFT_TTL_MS);
}
