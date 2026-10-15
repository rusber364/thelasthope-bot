// «лог-дискорда»: кто зашёл на сервер и кто вышел.
import { EmbedBuilder, Events, TimestampStyles, time, type Client } from 'discord.js';
import { detectInvite } from './invites.ts';
import { LOG_COLORS, sendLog } from './send.ts';

const NEW_ACCOUNT_DAYS = 7;
const MAX_ROLES = 15;

export function registerMemberLogs(client: Client): void {
  client.on(Events.GuildMemberAdd, async (member) => {
    const created = member.user.createdAt;
    const isNew = Date.now() - created.getTime() < NEW_ACCOUNT_DAYS * 24 * 60 * 60 * 1000;
    const embed = new EmbedBuilder()
      .setColor(LOG_COLORS.create)
      .setTitle(member.user.bot ? 'Добавлен бот' : 'Вход на сервер')
      .setThumbnail(member.user.displayAvatarURL())
      .setDescription(`${member} · ${member.user.tag}`)
      .addFields(
        { name: 'Аккаунт создан', value: `${time(created, TimestampStyles.LongDate)} (${time(created, TimestampStyles.RelativeTime)})${isNew ? '\n⚠️ Новый аккаунт' : ''}`, inline: true },
        { name: 'Участников', value: `${member.guild.memberCount}`, inline: true },
      )
      .setFooter({ text: `ID: ${member.id}` });
    if (!member.user.bot) embed.addFields({ name: 'Приглашение', value: await detectInvite(member.guild) });
    await sendLog(member.guild, 'members', embed);
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    const user = member.user;
    const embed = new EmbedBuilder()
      .setColor(LOG_COLORS.delete)
      .setTitle(user?.bot ? 'Бот удалён с сервера' : 'Выход с сервера')
      .setDescription(`<@${member.id}>${user ? ` · ${user.tag}` : ''}`)
      .setFooter({ text: `ID: ${member.id}` });
    if (user) embed.setThumbnail(user.displayAvatarURL());

    if (member.joinedAt) {
      embed.addFields({ name: 'Был на сервере с', value: `${time(member.joinedAt, TimestampStyles.LongDate)} (${time(member.joinedAt, TimestampStyles.RelativeTime)})` });
    }
    const roles = member.partial
      ? []
      : member.roles.cache
          .filter((role) => role.id !== member.guild.id)
          .sort((a, b) => b.position - a.position)
          .map((role) => `${role}`);
    if (roles.length) {
      const more = roles.length > MAX_ROLES ? ` и ещё ${roles.length - MAX_ROLES}` : '';
      embed.addFields({ name: `Роли (${roles.length})`, value: roles.slice(0, MAX_ROLES).join(' ') + more });
    }
    embed.addFields({ name: 'Участников', value: `${member.guild.memberCount}`, inline: true });
    await sendLog(member.guild, 'members', embed);
  });
}
