import { Events, MessageFlags, type Client, type GuildMember } from 'discord.js';
import { getSettings } from '../botSettings.ts';
import { buildWelcome } from '../welcome/welcome.ts';

/** Новый участник зашёл на сервер: выдаём автороль и пишем приветствие. */
export function registerWelcomeEvent(client: Client): void {
  client.on(Events.GuildMemberAdd, async (member) => {
    if (member.user.bot) return;
    await giveAutorole(member);
    await sendWelcome(member);
  });
}

async function giveAutorole(member: GuildMember): Promise<void> {
  const autoroleId = getSettings().roles.autorole;
  if (!autoroleId) return;
  const role = member.guild.roles.cache.get(autoroleId);
  if (!role) return; // роль с другого сервера или удалена

  try {
    await member.roles.add(role, 'Автороль для новичков');
  } catch (error) {
    console.error(`Не удалось выдать автороль ${role.name}. Роль бота должна быть выше неё.`, error);
  }
}

/** Пишет приветствие в канал приветствий. Возвращает false, если канал не настроен или недоступен. */
export async function sendWelcome(member: GuildMember): Promise<boolean> {
  const channelId = getSettings().channels.welcome;
  if (!channelId) return false;
  const channel = member.guild.channels.cache.get(channelId);
  if (!channel?.isSendable()) return false;

  try {
    await channel.send({ ...buildWelcome(member), flags: MessageFlags.IsComponentsV2 });
    return true;
  } catch (error) {
    console.error('Не удалось отправить приветствие:', error);
    return false;
  }
}
