// Оповещения офицерам: посещаемость рейдов, поздние отписки. В отличие от логов, здесь бот
// упоминает роль офицеров, чтобы пришло уведомление. Канал и роль — в админке → «Оповещения».
import type { AttachmentBuilder, EmbedBuilder, Guild } from 'discord.js';
import { getSettings } from '../botSettings.ts';

/** files — вложения к оповещению (например, картинки из анкеты). */
export async function sendAlert(guild: Guild, embed: EmbedBuilder, files: AttachmentBuilder[] = []): Promise<void> {
  const { channelId, roleId } = getSettings().alerts;
  if (!channelId) return;
  const channel = guild.channels.cache.get(channelId);
  if (!channel?.isSendable()) return;
  try {
    await channel.send({
      ...(roleId ? { content: `<@&${roleId}>` } : {}),
      embeds: [embed.setTimestamp()],
      files,
      // Уведомление получит только роль офицеров — упоминания игроков внутри оповещения не пингуют.
      allowedMentions: { roles: roleId ? [roleId] : [] },
    });
  } catch (error) {
    console.error('Не удалось отправить оповещение офицерам:', error);
  }
}
