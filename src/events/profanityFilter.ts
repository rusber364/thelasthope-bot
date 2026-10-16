import { Colors, Events, type Client, type Message, type PartialMessage } from 'discord.js';
import { settings } from '../settings.ts';
import { findProfanity } from '../lib/profanity.ts';
import { logModAction } from '../lib/modlog.ts';
import { markDeletedByBot } from '../logs/messages.ts';
import { reportIncident } from '../logs/incidents.ts';

/** Нарушения за последнее время: «сервер:пользователь» → моменты нарушений. */
const strikes = new Map<string, number[]>();

/**
 * Проверяет новые и отредактированные сообщения на мат.
 * Нужен привилегированный intent Message Content (Developer Portal → Bot), иначе бот не видит текст.
 */
export function registerProfanityFilter(client: Client): void {
  if (!settings.profanity.enabled) return;
  client.on(Events.MessageCreate, (message) => void check(message));
  client.on(Events.MessageUpdate, (_before, after) => void check(after));
}

async function check(message: Message | PartialMessage): Promise<void> {
  if (message.partial || !message.inGuild() || message.author.bot || message.system) return;
  if (settings.profanity.ignoredChannelIds.includes(message.channelId)) return;
  if (!findProfanity(message.content, settings.profanity.extraWords)) return;

  // Удаление запишется в «лог-модерация» ниже — в «лог-сообщения» его дублировать не нужно.
  markDeletedByBot(message.id);
  try {
    await message.delete();
  } catch (error) {
    console.error('Не удалось удалить сообщение с матом — нужно право «Управлять сообщениями»:', error);
    return;
  }

  const warning = await message.channel
    .send({ content: `⚠️ ${message.author}, без мата, пожалуйста — сообщение удалено.`, allowedMentions: { users: [message.author.id] } })
    .catch(() => null);
  if (warning) setTimeout(() => void warning.delete().catch(() => {}), settings.profanity.warningSeconds * 1000);

  const muted = await muteRepeatOffender(message);
  await logModAction(message.guild, {
    title: '🤬 Удалено сообщение с матом',
    color: Colors.DarkOrange,
    moderator: message.client.user,
    target: message.author,
    details: [
      `Канал: ${message.channel}`,
      `Текст: ||${message.content.replaceAll('|', '¦').slice(0, 800)}||`,
      muted ? `🔇 Мут на ${settings.profanity.muteMinutes} мин. за повторные нарушения` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  });
  await reportIncident(message.guild, {
    kind: 'profanity',
    user: message.author,
    channelId: message.channelId,
    details: `Сообщение удалено фильтром${muted ? `, выдан мут на ${settings.profanity.muteMinutes} мин. за повторы` : ''}.\nТекст: ||${message.content.replaceAll('|', '¦').slice(0, 800)}||`,
  });
}

/** Считает нарушения; если их набралось strikesToMute за окно времени — выдаёт мут. */
async function muteRepeatOffender(message: Message<true>): Promise<boolean> {
  const { strikesToMute, strikeWindowMinutes, muteMinutes } = settings.profanity;
  if (!strikesToMute) return false;

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
