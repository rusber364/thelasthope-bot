// Публикация, закрытие и итоги опросов — общее для команды /poll и админки.
import { extname } from 'node:path';
import { AttachmentBuilder, MessageFlags, PermissionFlagsBits, type Guild, type GuildTextBasedChannel } from 'discord.js';
import type { PollDefinition, QuestionKind } from './format.ts';
import { download } from '../lib/download.ts';
import { buildPublicMessage } from './render.ts';
import { closePoll, createPoll, deletePoll, setPollMessage, type PollResponse, type StoredPoll } from './store.ts';

export const MAX_IMAGE_SIZE = 8 * 1024 * 1024;

/** Права бота в канале, без которых опрос не опубликовать. */
export const PUBLISH_PERMISSIONS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles];

export interface PollImage {
  data: Buffer;
  /** Имя исходного файла — от него берётся расширение. */
  fileName: string;
}

export interface PublishOptions {
  image?: PollImage;
  mentionRoleId?: string;
  /** Исходный текст опроса — для «Создать копию» в админке. */
  source?: string;
}

/** Сохранить опрос и опубликовать сообщение с кнопкой. Если Discord не принял сообщение — запись удаляется. */
export async function publishPoll(
  channel: GuildTextBasedChannel,
  definition: PollDefinition,
  createdBy: string,
  options: PublishOptions = {},
): Promise<{ poll: StoredPoll; url: string }> {
  const def = structuredClone(definition);
  const files: AttachmentBuilder[] = [];
  if (options.image) {
    const name = `poll-image${extname(options.image.fileName) || '.png'}`;
    files.push(new AttachmentBuilder(options.image.data, { name }));
    def.image = `attachment://${name}`;
  }
  if (options.mentionRoleId) def.mentionRoleId = options.mentionRoleId;

  const stored = createPoll(channel.guildId, channel.id, def, createdBy, options.source ?? null);
  try {
    const message = await channel.send({ ...buildPublicMessage(stored), files, flags: MessageFlags.IsComponentsV2 });
    setPollMessage(stored.id, message.id);
    return { poll: { ...stored, messageId: message.id }, url: message.url };
  } catch (error) {
    deletePoll(stored.id);
    throw error;
  }
}

/** Закрыть опрос и перерисовать его сообщение. Прикреплённую картинку загружаем заново, чтобы она не пропала. */
export async function closeAndRedraw(guild: Guild, poll: StoredPoll): Promise<void> {
  closePoll(poll.id);
  if (!poll.messageId) return;
  try {
    const channel = guild.channels.cache.get(poll.channelId);
    if (!channel?.isTextBased()) return;
    const message = await channel.messages.fetch(poll.messageId);
    const files: AttachmentBuilder[] = [];
    for (const attachment of message.attachments.values()) {
      files.push(new AttachmentBuilder(await download(attachment.url), { name: attachment.name }));
    }
    await message.edit({ ...buildPublicMessage({ ...poll, closed: true }), files, attachments: [] });
  } catch (error) {
    console.error(`Не удалось обновить сообщение опроса #${poll.id}:`, error);
  }
}

/** Имена участников для итогов: «Ник (@логин)». Кого не нашли (ушли с сервера) — пропускаем. */
export async function memberNames(guild: Guild, userIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (let i = 0; i < userIds.length; i += 100) {
    const chunk = userIds.slice(i, i + 100);
    const members = await guild.members.fetch({ user: chunk }).catch(() => null);
    members?.forEach((member) => names.set(member.id, `${member.displayName} (@${member.user.username})`));
  }
  return names;
}

export interface QuestionStats {
  block: string;
  title: string;
  kind: QuestionKind;
  required: boolean;
  /** Сколько человек ответили на вопрос. */
  answered: number;
  options: { label: string; count: number; percent: number }[];
  /** Текстовые ответы. userId = null в анонимном опросе (и порядок там перемешан). */
  texts: { userId: string | null; text: string }[];
}

export interface PollStats {
  /** Начали опрос. */
  total: number;
  /** Дошли до конца. */
  completed: number;
  questions: QuestionStats[];
}

/** Итоги опроса: проценты по вариантам и текстовые ответы. Процент — от ответивших на вопрос. */
export function pollStats(poll: StoredPoll, responses: PollResponse[]): PollStats {
  const anonymous = poll.definition.anonymous;
  const questions = poll.definition.blocks.flatMap((block) =>
    block.questions.map((question): QuestionStats => {
      const answered = responses.filter((r) => (r.state.answers[question.id]?.length ?? 0) > 0);
      const options = question.options.map((option) => {
        const count = answered.filter((r) => r.state.answers[question.id]!.includes(option.value)).length;
        return { label: option.label, count, percent: answered.length ? Math.round((count / answered.length) * 100) : 0 };
      });
      const isText = question.kind === 'short' || question.kind === 'paragraph';
      const texts = isText
        ? answered.map((r) => ({ userId: anonymous ? null : r.userId, text: r.state.answers[question.id]![0]! })).filter((t) => t.text.trim())
        : [];
      if (anonymous) shuffle(texts);
      return { block: block.title, title: question.title, kind: question.kind, required: question.required, answered: answered.length, options, texts };
    }),
  );
  return { total: responses.length, completed: responses.filter((r) => r.completedAt).length, questions };
}

function shuffle<T>(items: T[]): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
}

export interface RespondentAnswers {
  userId: string;
  completed: boolean;
  updatedAt: number;
  /** Только вопросы, на которые человек ответил, в порядке опроса. */
  answers: { block: string; question: string; answer: string }[];
}

/** Ответы, сгруппированные по людям: сначала дошедшие до конца, внутри — свежие первыми (чистая функция). */
export function answersByUser(poll: StoredPoll, responses: PollResponse[]): RespondentAnswers[] {
  const questions = poll.definition.blocks.flatMap((block) => block.questions.map((question) => ({ block: block.title, question })));
  return responses
    .map((response) => ({
      userId: response.userId,
      completed: response.completedAt !== null,
      updatedAt: response.updatedAt,
      answers: questions.flatMap(({ block, question }) => {
        const values = response.state.answers[question.id] ?? [];
        if (!values.length || !values.some((v) => v.trim())) return [];
        const answer =
          question.kind === 'short' || question.kind === 'paragraph'
            ? values[0]!
            : values.map((value) => question.options.find((o) => o.value === value)?.label ?? value).join('; ');
        return [{ block, question: question.title, answer }];
      }),
    }))
    .sort((a, b) => Number(b.completed) - Number(a.completed) || b.updatedAt - a.updatedAt);
}
