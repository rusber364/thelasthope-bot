import { Colors, Events, type Client, type Message, type PartialMessage } from 'discord.js';
import { getSettings } from '../botSettings.ts';
import { findProfanity } from '../lib/profanity.ts';
import { logModAction } from '../lib/modlog.ts';
import { markDeletedByBot } from '../logs/messages.ts';
import { reportIncident } from '../logs/incidents.ts';

/** Нарушения за последнее время: «сервер:пользователь» → моменты нарушений. */
const strikes = new Map<string, number[]>();

/**
 * Проверяет новые и отредактированные сообщения на мат. Настройки (страница «Фильтр мата» в админке) читаются
 * на каждом сообщении — выключение, уровень и действие применяются без перезапуска.
 * Нужен привилегированный intent Message Content (Developer Portal → Bot), иначе бот не видит текст.
 */
export function registerProfanityFilter(client: Client): void {
  client.on(Events.MessageCreate, (message) => void checkProfanity(message));
  client.on(Events.MessageUpdate, (_before, after) => void checkProfanity(after));
}

/** Что сделал фильтр (для тестов): ничего, только сообщил, удалил или удалил и выдал мут. */
export type ProfanityOutcome = 'none' | 'reported' | 'deleted' | 'muted';

export async function checkProfanity(message: Message | PartialMessage): Promise<ProfanityOutcome> {
  if (message.partial || !message.inGuild() || message.author.bot || message.system) return 'none';
  const settings = getSettings().profanity;
  if (!settings.enabled || settings.ignoredChannelIds.includes(message.channelId)) return 'none';
  if (!findProfanity(message.content, settings.extraWords, settings.level)) return 'none';
  const text = `||${message.content.replaceAll('|', '¦').slice(0, 800)}||`;

  // «Только сообщить»: сообщение остаётся, модераторам — карточка с кнопками «Мут / Бан / Пропустить».
  if (settings.action === 'report') {
    await reportIncident(message.guild, {
      kind: 'profanity',
      user: message.author,
      channelId: message.channelId,
      details: `Сообщение не удалено (фильтр только сообщает): ${message.url}\nТекст: ${text}`,
    });
    return 'reported';
  }

  // Удаление запишется в «лог-модерация» ниже — в «лог-сообщения» его дублировать не нужно.
  markDeletedByBot(message.id);
  try {
    await message.delete();
  } catch (error) {
    console.error('Не удалось удалить сообщение с матом — нужно право «Управлять сообщениями»:', error);
    return 'none';
  }

  if (settings.warningSeconds > 0) {
    const warning = await message.channel
      .send({ content: `⚠️ ${message.author}, без мата, пожалуйста — сообщение удалено.`, allowedMentions: { users: [message.author.id] } })
      .catch(() => null);
    if (warning) setTimeout(() => void warning.delete().catch(() => {}), settings.warningSeconds * 1000);
  }

  const muted = settings.action === 'mute' && (await muteRepeatOffender(message));
  await logModAction(message.guild, {
    title: '🤬 Удалено сообщение с матом',
    color: Colors.DarkOrange,
    moderator: message.client.user,
    target: message.author,
    details: [`Канал: ${message.channel}`, `Текст: ${text}`, muted ? `🔇 Мут на ${settings.muteMinutes} мин. за повторные нарушения` : '']
      .filter(Boolean)
      .join('\n'),
  });
  await reportIncident(message.guild, {
    kind: 'profanity',
    user: message.author,
    channelId: message.channelId,
    details: `Сообщение удалено фильтром${muted ? `, выдан мут на ${settings.muteMinutes} мин. за повторы` : ''}.\nТекст: ${text}`,
  });
  return muted ? 'muted' : 'deleted';
}

/** Считает нарушения; если их набралось strikesToMute за окно времени — выдаёт мут. */
async function muteRepeatOffender(message: Message<true>): Promise<boolean> {
  const { strikesToMute, strikeWindowMinutes, muteMinutes } = getSettings().profanity;
  const key = `${message.guildId}:${message.author.id}`;
  const now = Date.now();
  const recent = (strikes.get(key) ?? []).filter((at) => now - at < strikeWindowMinutes * 60_000);
  recent.push(now);
  strikes.set(key, recent);
  if (recent.length < strikesToMute) return false;

  strikes.delete(key);
  const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
  if (!member?.moderatable) return false;
  try {
    await member.timeout(muteMinutes * 60_000, `Мат: ${strikesToMute} нарушения за ${strikeWindowMinutes} мин.`);
    return true;
  } catch (error) {
    console.error('Не удалось выдать мут за мат:', error);
    return false;
  }
}
