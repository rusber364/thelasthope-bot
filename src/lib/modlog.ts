import { EmbedBuilder, type Guild, type User } from 'discord.js';
import { sendLog } from '../logs/send.ts';

interface ModAction {
  title: string;
  color: number;
  moderator: User;
  target?: User;
  reason?: string;
  /** Дополнительные сведения: длительность мута, канал и т.п. */
  details?: string;
}

/** Пишет действие модератора (через команды бота) в «лог-модерация». */
export async function logModAction(guild: Guild, action: ModAction): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(action.color)
    .setTitle(action.title)
    .addFields({ name: 'Модератор', value: `${action.moderator} (${action.moderator.tag})`, inline: true });
  if (action.target) embed.addFields({ name: 'Участник', value: `${action.target} (${action.target.tag})`, inline: true });
  if (action.details) embed.addFields({ name: 'Подробности', value: action.details });
  if (action.reason) embed.addFields({ name: 'Причина', value: action.reason });

  await sendLog(guild, 'moderation', embed);
}
