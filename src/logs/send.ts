// Отправка записей в лог-каналы. Какой канал и включён ли лог — из настроек (админка → «Логи»).
import { Colors, EmbedBuilder, type Guild } from 'discord.js';
import { LOG_CATEGORIES, LOG_LABELS, getSettings, type LogCategory } from '../botSettings.ts';

/** Цвета записей: создание — зелёный, удаление — красный, изменение — синий, предупреждение — оранжевый. */
export const LOG_COLORS = {
  create: Colors.Green,
  delete: Colors.Red,
  update: Colors.Blurple,
  warn: Colors.Orange,
};

export async function sendLog(guild: Guild, category: LogCategory, embed: EmbedBuilder): Promise<void> {
  const { channelId, enabled } = getSettings().logs[category];
  if (!enabled || !channelId) return;
  const channel = guild.channels.cache.get(channelId);
  if (!channel?.isSendable()) return;
  try {
    // В embed'ах упоминания не пингуют, но на всякий случай запрещаем их явно.
    await channel.send({ embeds: [embed.setTimestamp()], allowedMentions: { parse: [] } });
  } catch (error) {
    console.error(`Не удалось записать в ${LOG_LABELS[category].title}:`, error);
  }
}

/** Сообщения в самих лог-каналах не логируем — иначе журнал будет писать сам о себе. */
export function isLogChannel(channelId: string): boolean {
  const { logs } = getSettings();
  return LOG_CATEGORIES.some((category) => logs[category].channelId === channelId);
}

/** Тестовая запись во все настроенные лог-каналы (кнопка в админке). Возвращает, куда удалось отправить. */
export async function sendTestLogs(guild: Guild, who: string): Promise<LogCategory[]> {
  const sent: LogCategory[] = [];
  for (const category of LOG_CATEGORIES) {
    const { channelId, enabled } = getSettings().logs[category];
    if (!enabled || !channelId || !guild.channels.cache.get(channelId)?.isSendable()) continue;
    await sendLog(
      guild,
      category,
      new EmbedBuilder()
        .setColor(LOG_COLORS.update)
        .setTitle('Проверка лога')
        .setDescription(`Сюда будут приходить: ${LOG_LABELS[category].hint}.\nПроверку запустил ${who} из админки.`),
    );
    sent.push(category);
  }
  return sent;
}
