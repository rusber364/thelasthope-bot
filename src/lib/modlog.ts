import { EmbedBuilder, type Guild, type User } from 'discord.js';
import { config } from '../config.ts';

interface ModAction {
  title: string;
  color: number;
  moderator: User;
  target?: User;
  reason?: string;
  /** Дополнительные сведения: длительность мута, канал и т.п. */
  details?: string;
}

/** Пишет действие модератора в канал-журнал, если задан MOD_LOG_CHANNEL_ID. */
export async function logModAction(guild: Guild, action: ModAction): Promise<void> {
  if (!config.modLogChannelId) return;
  const channel = guild.channels.cache.get(config.modLogChannelId);
  if (!channel?.isSendable()) return;

  const embed = new EmbedBuilder()
    .setColor(action.color)
    .setTitle(action.title)
    .addFields({ name: 'Модератор', value: `${action.moderator} (${action.moderator.tag})`, inline: true })
    .setTimestamp();
  if (action.target) embed.addFields({ name: 'Участник', value: `${action.target} (${action.target.tag})`, inline: true });
  if (action.details) embed.addFields({ name: 'Подробности', value: action.details });
  if (action.reason) embed.addFields({ name: 'Причина', value: action.reason });

  try {
    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error('Не удалось записать в журнал модерации:', error);
  }
}
