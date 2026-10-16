// Автоочистка каналов (как в Carl-bot Premium): в выбранных каналах бот сам удаляет сообщения старше N часов —
// например, во флуде или ЛФГ. Закреплённые не трогает, сообщения самого бота (реги, опросы) — по галочке.
import { EmbedBuilder, SnowflakeUtil, type Client, type Message } from 'discord.js';
import { getSettings, type AutoCleanRule } from '../botSettings.ts';
import { markDeletedByBot } from '../logs/messages.ts';
import { LOG_COLORS, sendLog } from '../logs/send.ts';

const RUN_EVERY_MS = 10 * 60_000;
const HOUR = 60 * 60 * 1000;
/** Discord удаляет пачкой только сообщения моложе 14 дней (берём с запасом в час). */
export const BULK_MAX_AGE_MS = 14 * 24 * HOUR - HOUR;
/** Сколько сообщений просматривать в канале за один проход. */
const MAX_FETCH = 1000;
/** Старые сообщения удаляются по одному — не больше стольких за проход, остальные в следующий раз. */
export const MAX_SINGLE_DELETES = 25;

type CleanableMessage = Pick<Message, 'id' | 'pinned' | 'createdTimestamp'> & { author: { id: string } };

/** Можно ли удалить сообщение по правилу (чистая функция). */
export function isCleanable(message: CleanableMessage, rule: AutoCleanRule, now: number, botId: string): boolean {
  if (message.pinned) return false;
  if (rule.keepBot && message.author.id === botId) return false;
  return message.createdTimestamp <= now - rule.hours * HOUR;
}

/** Нужное от канала: прочитать историю и удалить сообщения. */
export interface CleanableChannel {
  id: string;
  messages: {
    fetch(options: { limit: number; before: string }): Promise<Map<string, CleanableMessage>>;
    delete(id: string): Promise<unknown>;
  };
  bulkDelete(ids: string[], filterOld: boolean): Promise<unknown>;
}

/** Почистить один канал. Возвращает, сколько сообщений удалено. */
export async function cleanChannel(channel: CleanableChannel, rule: AutoCleanRule, now: number, botId: string): Promise<number> {
  const recent: string[] = [];
  const old: string[] = [];
  // Начинаем сразу с момента отсечки: всё новее него удалять не нужно, и читать его незачем.
  let before = SnowflakeUtil.generate({ timestamp: now - rule.hours * HOUR }).toString();
  for (let fetched = 0; fetched < MAX_FETCH; ) {
    const batch = [...(await channel.messages.fetch({ limit: 100, before })).values()];
    if (!batch.length) break;
    for (const message of batch) {
      if (!isCleanable(message, rule, now, botId)) continue;
      (now - message.createdTimestamp < BULK_MAX_AGE_MS ? recent : old).push(message.id);
    }
    fetched += batch.length;
    before = batch.at(-1)!.id;
    if (batch.length < 100) break;
  }

  let deleted = 0;
  for (let i = 0; i < recent.length; i += 100) {
    const chunk = recent.slice(i, i + 100);
    chunk.forEach(markDeletedByBot); // в «лог-сообщения» — одна сводка вместо записи на каждое сообщение
    if (chunk.length === 1) await channel.messages.delete(chunk[0]!);
    else await channel.bulkDelete(chunk, true);
    deleted += chunk.length;
  }
  for (const id of old.slice(0, MAX_SINGLE_DELETES)) {
    markDeletedByBot(id);
    await channel.messages.delete(id).catch(() => {});
    deleted += 1;
  }
  return deleted;
}

/** Один проход по всем каналам из настроек. */
export async function runAutoClean(client: Client): Promise<void> {
  const botId = client.user?.id ?? '';
  for (const rule of getSettings().autoClean) {
    const channel = client.channels.cache.get(rule.channelId);
    if (!channel?.isTextBased() || channel.isDMBased() || !('bulkDelete' in channel)) continue;
    try {
      const deleted = await cleanChannel(channel as unknown as CleanableChannel, rule, Date.now(), botId);
      if (!deleted) continue;
      await sendLog(
        channel.guild,
        'messages',
        new EmbedBuilder()
          .setColor(LOG_COLORS.delete)
          .setTitle('Автоочистка канала')
          .addFields(
            { name: 'Канал', value: `<#${channel.id}>`, inline: true },
            { name: 'Удалено', value: String(deleted), inline: true },
            { name: 'Правило', value: `старше ${rule.hours} ч${rule.keepBot ? ', кроме сообщений бота' : ''}, кроме закреплённых`, inline: true },
          ),
      );
    } catch (error) {
      console.error(`Автоочистка #${channel.name}:`, error);
    }
  }
}

let started = false;
export function startAutoClean(client: Client): void {
  if (started) return;
  started = true;
  const run = () => void runAutoClean(client).catch((error) => console.error('Автоочистка:', error));
  run();
  setInterval(run, RUN_EVERY_MS);
}
