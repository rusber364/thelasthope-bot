import { Events, MessageFlags, type Client, type GuildMember } from 'discord.js';
import { config } from '../config.ts';
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
  if (!config.autoroleId) return;
  const role = member.guild.roles.cache.get(config.autoroleId);
  if (!role) return; // роль с другого сервера или удалена

  try {
    await member.roles.add(role, 'Автороль для новичков');
  } catch (error) {
    console.error(`Не удалось выдать автороль ${role.name}. Роль бота должна быть выше неё.`, error);
  }
}

async function sendWelcome(member: GuildMember): Promise<void> {
  if (!config.welcomeChannelId) return;
  const channel = member.guild.channels.cache.get(config.welcomeChannelId);
  if (!channel?.isSendable()) return;

  try {
    await channel.send({ ...buildWelcome(member), flags: MessageFlags.IsComponentsV2 });
  } catch (error) {
    console.error('Не удалось отправить приветствие:', error);
  }
}
