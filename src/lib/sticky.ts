// Липкие сообщения (как в Carl-bot Premium): текст, который всегда последний в канале.
// После новых сообщений бот удаляет свою прошлую копию и публикует текст заново внизу —
// не чаще раза в N секунд, а пачка сообщений подряд даёт одну перестановку.
// Роли из настроек упоминаются в начале сообщения; уведомление они получают только при первой публикации
// и после изменения текста или ролей — иначе пинг приходил бы после каждой пачки сообщений в канале.
import { Events, type Client, type Guild, type Message, type SendableChannels } from 'discord.js';
import { getSettings, type StickyItem } from '../botSettings.ts';
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

type StickyContent = Pick<StickyItem, 'text' | 'roleIds'>;

function stickyFor(channelId: string): StickyItem | null {
  return getSettings().sticky.items.find((item) => item.channelId === channelId) ?? null;
}

/** Текст сообщения: упоминания ролей отдельной строкой в начале, затем текст и подпись «закреплено». */
export function stickyContent(item: StickyContent): string {
  const mentions = item.roleIds.map((id) => `<@&${id}>`).join(' ');
  return (mentions ? `${mentions}
` : '') + item.text + FOOTER;
}

const signatureOf = (item: StickyContent) => JSON.stringify([item.text, item.roleIds]);

function stored(channelId: string): { messageId: string; signature: string | null } | null {
  const row = db.prepare('SELECT message_id, signature FROM sticky_messages WHERE channel_id = ?').get(channelId) as
    | { message_id: string; signature: string | null }
    | undefined;
  return row ? { messageId: row.message_id, signature: row.signature } : null;
}

function storeMessage(channelId: string, messageId: string | null, signature: string | null = null): void {
  if (messageId) {
    db.prepare(
      'INSERT INTO sticky_messages (channel_id, message_id, signature) VALUES (?, ?, ?) ON CONFLICT (channel_id) DO UPDATE SET message_id = excluded.message_id, signature = excluded.signature',
    ).run(channelId, messageId, signature);
  } else db.prepare('DELETE FROM sticky_messages WHERE channel_id = ?').run(channelId);
}

/** Удалить прошлую копию и опубликовать сообщение заново. item = null — только убрать закреп. */
export async function repostSticky(
  channel: SendableChannels & { id: string; messages: { delete(id: string): Promise<unknown> } },
  item: StickyContent | null,
): Promise<void> {
  const previous = stored(channel.id);
  if (previous) {
    markDeletedByBot(previous.messageId); // своя прошлая копия — в «лог-сообщения» не пишем
    await channel.messages.delete(previous.messageId).catch(() => {});
  }
  if (!item) {
    storeMessage(channel.id, null);
    return;
  }
  // Уведомление ролям — только если такого текста с такими ролями ещё не публиковали; при перестановке упоминание
  // видно, но без повторного пинга.
  const signature = signatureOf(item);
  const notify = previous?.signature !== signature;
  const message = await channel.send({ content: stickyContent(item), allowedMentions: notify ? { roles: item.roleIds } : { parse: [] } });
  storeMessage(channel.id, message.id, signature);
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
      const item = stickyFor(channelId);
      if (item && message.channel.isSendable()) {
        void repostSticky(message.channel, item).catch((error) => console.error('Не удалось переставить закреп:', error));
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
  const published = db.prepare('SELECT channel_id FROM sticky_messages').all() as { channel_id: string }[];

  for (const { channel_id: channelId } of published) {
    if (configured.has(channelId)) continue;
    const channel = guild.channels.cache.get(channelId);
    if (channel?.isSendable() && 'messages' in channel) await repostSticky(channel, null);
    else storeMessage(channelId, null);
  }
  for (const item of items) {
    const channel = guild.channels.cache.get(item.channelId);
    if (!channel?.isSendable() || !('messages' in channel)) continue;
    const current = stored(item.channelId)?.messageId;
    // Закреп уже последний и текст не менялся — трогать не нужно.
    if (!force && current && channel.lastMessageId === current) continue;
    await repostSticky(channel, item).catch((error) => console.error('Не удалось опубликовать закреп:', error));
  }
}
