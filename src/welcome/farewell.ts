// Прощание: когда участник уходит с сервера, бот пишет в отдельный канал (как в Carl-bot Premium).
import { Events, type Client, type GuildMember, type PartialGuildMember } from 'discord.js';
import { getSettings } from '../botSettings.ts';

export interface FarewellData {
  userId: string;
  name: string;
  server: string;
  members: number;
}

/** Подстановки в текст прощания: {user} {name} {server} {members}. */
export function fillFarewell(text: string, data: FarewellData): string {
  return text
    .replaceAll('{user}', `<@${data.userId}>`)
    .replaceAll('{name}', data.name)
    .replaceAll('{server}', data.server)
    .replaceAll('{members}', String(data.members));
}

/** Пишет прощание в канал прощаний. Возвращает false, если канал не настроен или недоступен. */
export async function sendFarewell(member: GuildMember | PartialGuildMember): Promise<boolean> {
  const { channelId, text } = getSettings().farewell;
  if (!channelId) return false;
  const channel = member.guild.channels.cache.get(channelId);
  if (!channel?.isSendable()) return false;

  const name = member.displayName ?? member.user?.username ?? 'Участник';
  try {
    await channel.send({
      content: fillFarewell(text, { userId: member.id, name, server: member.guild.name, members: member.guild.memberCount }),
      // Человек уже ушёл — упоминание никого не пингует, но на всякий случай запрещаем явно.
      allowedMentions: { parse: [] },
    });
    return true;
  } catch (error) {
    console.error('Не удалось отправить прощание:', error);
    return false;
  }
}

export function registerFarewell(client: Client): void {
  client.on(Events.GuildMemberRemove, async (member) => {
    if (member.user?.bot) return;
    await sendFarewell(member);
  });
}
