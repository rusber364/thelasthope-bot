// Липкие сообщения (как в Carl-bot Premium): текст, который всегда последний в канале.
// После новых сообщений бот удаляет свою прошлую копию и публикует текст заново внизу —
// не чаще раза в N секунд, а пачка сообщений подряд даёт одну перестановку.
import { Events, type Client, type Guild, type Message, type SendableChannels } from 'discord.js';
import { getSettings } from '../botSettings.ts';
import { db } from '../db.ts';
import { markDeletedByBot } from '../logs/messages.ts';

/** Минимальная пауза после последнего сообщения: чтобы поток сообщений не дёргал закреп. */
const QUIET_MS = 3_000;
const FOOTER = '\n-# 📌 закреплено';

/** Через сколько мс переставить закреп: не раньше паузы тишины и не раньше, чем через interval после прошлой перестановки. */
export function nextRepostDelay(now: number, lastRepostAt: number, intervalMs: number, quietMs = QUIET_MS): number {
  return Math.max(quietMs, lastRepostAt + intervalMs - now);
}

const timers = new Map<string, NodeJS.Timeout>();
const lastRepost = new Map<string, number>();

function stickyFor(channelId: string): string | null {
  return getSettings().sticky.items.find((item) => item.channelId === channelId)?.text ?? null;
}

function storedMessageId(channelId: string): string | null {
  const row = db.prepare('SELECT message_id FROM sticky_messages WHERE channel_id = ?').get(channelId) as { message_id: string } | undefined;
  return row?.message_id ?? null;
}

function storeMessageId(channelId: string, messageId: string | null): void {
  if (messageId) db.prepare('INSERT INTO sticky_messages (channel_id, message_id) VALUES (?, ?) ON CONFLICT (channel_id) DO UPDATE SET message_id = excluded.message_id').run(channelId, messageId);
  else db.prepare('DELETE FROM sticky_messages WHERE channel_id = ?').run(channelId);
}

/** Удалить прошлую копию и опубликовать текст заново. text = null — только убрать закреп. */
export async function repostSticky(channel: SendableChannels & { id: string; messages: { delete(id: string): Promise<unknown> } }, text: string | null): Promise<void> {
  const previous = storedMessageId(channel.id);
  if (previous) {
    markDeletedByBot(previous); // своя прошлая копия — в «лог-сообщения» не пишем
    await channel.messages.delete(previous).catch(() => {});
  }
  if (!text) {
    storeMessageId(channel.id, null);
    return;
  }
  const message = await channel.send({ content: text + FOOTER, allowedMentions: { parse: [] } });
  storeMessageId(channel.id, message.id);
  lastRepost.set(channel.id, Date.now());
}

function schedule(message: Message<true>): void {
  const channelId = message.channelId;
  if (timers.has(channelId)) return; // перестановка уже запланирована
  const intervalMs = getSettings().sticky.intervalSeconds * 1000;
  const delay = nextRepostDelay(Date.now(), lastRepost.get(channelId) ?? 0, intervalMs);
  timers.set(
    channelId,
    setTimeout(() => {
      timers.delete(channelId);
      const text = stickyFor(channelId);
      if (text && message.channel.isSendable()) {
        void repostSticky(message.channel, text).catch((error) => console.error('Не удалось переставить закреп:', error));
      }
    }, delay),
  );
}

export function registerSticky(client: Client): void {
  client.on(Events.MessageCreate, (message) => {
    if (!message.inGuild() || !stickyFor(message.channelId)) return;
    // Собственную копию закрепа не считаем «новым сообщением», иначе бот переставлял бы её бесконечно.
    if (message.author.id === message.client.user.id && message.content.endsWith(FOOTER)) return;
    schedule(message);
  });
}

/**
 * Привести закрепы на сервере к настройкам: в каналах из настроек — текст внизу (если он ещё не последний),
 * в каналах, убранных из настроек, — удалить старую копию. Вызывается при запуске и после сохранения в админке.
 */
export async function refreshStickies(guild: Guild, force = false): Promise<void> {
  const items = getSettings().sticky.items;
  const configured = new Set(items.map((item) => item.channelId));
  const stored = db.prepare('SELECT channel_id FROM sticky_messages').all() as { channel_id: string }[];

  for (const { channel_id: channelId } of stored) {
    if (configured.has(channelId)) continue;
    const channel = guild.channels.cache.get(channelId);
    if (channel?.isSendable() && 'messages' in channel) await repostSticky(channel, null);
    else storeMessageId(channelId, null);
  }
  for (const item of items) {
    const channel = guild.channels.cache.get(item.channelId);
    if (!channel?.isSendable() || !('messages' in channel)) continue;
    const current = storedMessageId(item.channelId);
    // Закреп уже последний и текст не менялся — трогать не нужно.
    if (!force && current && channel.lastMessageId === current) continue;
    await repostSticky(channel, item.text).catch((error) => console.error('Не удалось опубликовать закреп:', error));
  }
}
