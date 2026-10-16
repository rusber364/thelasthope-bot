// Временные каналы (как в Carl-bot Premium): канал под разовое событие сам удаляется через заданный срок.
// Срок хранится в базе, поэтому канал удалится и после перезапуска бота.
import { ChannelType, type Client } from 'discord.js';
import { db } from '../db.ts';

const CHECK_EVERY_MS = 60_000;

export function rememberTempChannel(guildId: string, channelId: string, expiresAt: number, createdBy: string): void {
  db.prepare('INSERT INTO temp_channels (channel_id, guild_id, expires_at, created_by) VALUES (?, ?, ?, ?)').run(channelId, guildId, expiresAt, createdBy);
}

export function tempChannelExpiry(channelId: string): number | null {
  const row = db.prepare('SELECT expires_at FROM temp_channels WHERE channel_id = ?').get(channelId) as { expires_at: number } | undefined;
  return row ? Number(row.expires_at) : null;
}

function forget(channelId: string): void {
  db.prepare('DELETE FROM temp_channels WHERE channel_id = ?').run(channelId);
}

/** Удалить каналы, срок которых истёк. Голосовой канал, где кто-то сидит, ждёт, пока не опустеет. */
export async function expireTempChannels(client: Client, now = Date.now()): Promise<void> {
  const due = db.prepare('SELECT channel_id, guild_id FROM temp_channels WHERE expires_at <= ?').all(now) as { channel_id: string; guild_id: string }[];
  for (const { channel_id: channelId, guild_id: guildId } of due) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue; // бот не видит сервер — попробуем позже
    const channel = guild.channels.cache.get(channelId);
    if (!channel) {
      forget(channelId); // уже удалили руками
      continue;
    }
    if (channel.type === ChannelType.GuildVoice && channel.members.size > 0) continue;
    try {
      await channel.delete('Срок временного канала истёк');
      forget(channelId);
    } catch (error) {
      console.error(`Не удалось удалить временный канал #${channel.name}:`, error);
    }
  }
}

export function startTempChannelExpiry(client: Client): void {
  const run = () => void expireTempChannels(client).catch((error) => console.error('Временные каналы:', error));
  run();
  setInterval(run, CHECK_EVERY_MS);
}
