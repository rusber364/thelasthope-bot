import { Colors, EmbedBuilder, InteractionContextType, SlashCommandBuilder, TimestampStyles, time } from 'discord.js';
import type { Command } from '../../types.ts';

const MAX_ROLES_SHOWN = 15;

export const user: Command = {
  data: new SlashCommandBuilder()
    .setName('user')
    .setDescription('Информация об участнике')
    .addUserOption((option) => option.setName('user').setDescription('О ком показать (по умолчанию — о тебе)'))
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const target = interaction.options.getUser('user') ?? interaction.user;
    // Если пользователь не на сервере, member будет null — покажем только общие данные.
    const member = interaction.options.getMember('user') ?? (target.id === interaction.user.id ? interaction.member : null);

    const embed = new EmbedBuilder()
      .setColor(member?.displayColor || Colors.Blurple)
      .setTitle(member?.displayName ?? target.displayName)
      .setThumbnail(target.displayAvatarURL())
      .addFields(
        { name: 'Имя пользователя', value: target.tag, inline: true },
        { name: 'Аккаунт создан', value: time(target.createdAt, TimestampStyles.LongDate), inline: true },
      )
      .setFooter({ text: `ID: ${target.id}` });

    if (member?.joinedAt) {
      embed.addFields({ name: 'На сервере с', value: time(member.joinedAt, TimestampStyles.LongDate), inline: true });
    }

    if (member) {
      const roles = member.roles.cache
        .filter((role) => role.id !== interaction.guild.id)
        .sort((a, b) => b.position - a.position)
        .map((role) => role.toString());
      const shown = roles.slice(0, MAX_ROLES_SHOWN).join(' ');
      const more = roles.length > MAX_ROLES_SHOWN ? ` и ещё ${roles.length - MAX_ROLES_SHOWN}` : '';
      embed.addFields({ name: `Роли (${roles.length})`, value: roles.length ? shown + more : 'нет' });
    }

    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
