// Живой список ближайших рейдов (как обзор событий в Raid-Helper Premium): одно сообщение в выбранном канале,
// которое бот сам обновляет при создании, записи, отмене и закрытии рег.
import { EmbedBuilder, TimestampStyles, time, type Client } from 'discord.js';
import { getSettings } from '../botSettings.ts';
import { db } from '../db.ts';
import { markDeletedByBot } from '../logs/messages.ts';
import { uiEmoji } from './emojis.ts';
import { KINDS } from './kinds.ts';
import { getSignups, upcomingRaids, type Raid } from './store.ts';

const ACCENT = 0xc69b3a;
/** Сколько ждать после изменения: пачка записей подряд даёт одно обновление списка. */
const DEBOUNCE_MS = 1500;

export interface BoardEntry {
  raid: Raid;
  /** Записались в состав (без «под вопросом»). */
  signed: number;
  tentative: number;
}

/** Сообщение со списком (чистая функция — легко проверить). */
export function buildBoard(entries: BoardEntry[]): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(ACCENT).setTitle(`${uiEmoji('date')} Ближайшие сборы`).setFooter({ text: 'Список обновляется сам' });
  if (!entries.length) return embed.setDescription('Открытых рег пока нет.');

  const blocks = entries.map(({ raid, signed, tentative }) => {
    const start = new Date(raid.startsAt);
    const url = `https://discord.com/channels/${raid.guildId}/${raid.channelId}/${raid.messageId ?? ''}`;
    const counts = `${uiEmoji('signups')} ${signed}/${raid.size}${tentative ? ` · ${uiEmoji('tentative')} ${tentative}` : ''}`;
    // У рейдов вид не пишем — их большинство; у подземелий и PvP — метка рядом с названием.
    const kind = raid.kind === 'raid' ? '' : ` · ${KINDS[raid.kind].title}`;
    return `**[${raid.title}](${url})**${kind}\n${uiEmoji('time')} ${time(start, TimestampStyles.ShortDateTime)} · ${time(start, TimestampStyles.RelativeTime)}\n${counts} · <#${raid.channelId}>`;
  });
  let description = '';
  for (const [index, block] of blocks.entries()) {
    const next = description ? `${description}\n\n${block}` : block;
    if (next.length > 3900) {
      description += `\n\n…и ещё ${blocks.length - index}`;
      break;
    }
    description = next;
  }
  return embed.setDescription(description);
}

function boardEntries(guildId: string): BoardEntry[] {
  return upcomingRaids(guildId).map((raid) => {
    const signups = getSignups(raid.id);
    const tentative = signups.filter((s) => s.tentative).length;
    return { raid, signed: signups.length - tentative, tentative };
  });
}

type BoardRow = { channel_id: string; message_id: string };
const storedBoard = (guildId: string) => db.prepare('SELECT channel_id, message_id FROM raid_boards WHERE guild_id = ?').get(guildId) as BoardRow | undefined;

/** Привести список на сервере к настройкам: создать, обновить, перенести в другой канал или убрать. */
export async function refreshBoard(client: Client, guildId: string): Promise<void> {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;
  const channelId = getSettings().raids.boardChannelId;
  const stored = storedBoard(guildId);

  // Канал сменили или список выключили — убираем старое сообщение.
  if (stored && stored.channel_id !== channelId) {
    const old = guild.channels.cache.get(stored.channel_id);
    markDeletedByBot(stored.message_id); // своё сообщение — в «лог-сообщения» не пишем
    if (old?.isTextBased()) await old.messages.delete(stored.message_id).catch(() => {});
    db.prepare('DELETE FROM raid_boards WHERE guild_id = ?').run(guildId);
  }
  if (!channelId) return;
  const channel = guild.channels.cache.get(channelId);
  if (!channel?.isTextBased()) return;

  const payload = { embeds: [buildBoard(boardEntries(guildId))], allowedMentions: { parse: [] } };
  if (stored && stored.channel_id === channelId) {
    const edited = await channel.messages.edit(stored.message_id, payload).then(
      () => true,
      () => false, // сообщение удалили руками — опубликуем заново
    );
    if (edited) return;
  }
  const message = await channel.send(payload);
  db.prepare(
    'INSERT INTO raid_boards (guild_id, channel_id, message_id) VALUES (?, ?, ?) ON CONFLICT (guild_id) DO UPDATE SET channel_id = excluded.channel_id, message_id = excluded.message_id',
  ).run(guildId, channelId, message.id);
}

const timers = new Map<string, NodeJS.Timeout>();
const running = new Map<string, Promise<void>>();

/** Попросить обновить список: изменения за полторы секунды склеиваются, обновления не идут параллельно. */
export function requestBoardRefresh(client: Client, guildId: string): void {
  if (!getSettings().raids.boardChannelId && !storedBoard(guildId)) return; // список не включён — нечего обновлять
  if (timers.has(guildId)) return;
  timers.set(
    guildId,
    setTimeout(() => {
      timers.delete(guildId);
      const previous = running.get(guildId) ?? Promise.resolve();
      const run = previous.then(() => refreshBoard(client, guildId)).catch((error) => console.error('Не удалось обновить список рейдов:', error));
      running.set(guildId, run);
      void run.then(() => {
        if (running.get(guildId) === run) running.delete(guildId);
      });
    }, DEBOUNCE_MS),
  );
}
