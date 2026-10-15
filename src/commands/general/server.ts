import { Colors, EmbedBuilder, InteractionContextType, SlashCommandBuilder, TimestampStyles, time } from 'discord.js';
import type { Command } from '../../types.ts';

export const server: Command = {
  data: new SlashCommandBuilder()
    .setName('server')
    .setDescription('Информация о сервере')
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const { guild } = interaction;
    const owner = await guild.fetchOwner();

    const embed = new EmbedBuilder()
      .setColor(Colors.Blurple)
      .setTitle(guild.name)
      .setThumbnail(guild.iconURL())
      .addFields(
        { name: 'Владелец', value: `${owner}`, inline: true },
        { name: 'Участников', value: `${guild.memberCount}`, inline: true },
        { name: 'Создан', value: time(guild.createdAt, TimestampStyles.LongDate), inline: true },
        { name: 'Каналов', value: `${guild.channels.cache.size}`, inline: true },
        { name: 'Ролей', value: `${guild.roles.cache.size - 1}`, inline: true },
        { name: 'Бустов', value: `${guild.premiumSubscriptionCount ?? 0}`, inline: true },
      )
      .setFooter({ text: `ID: ${guild.id}` });

    await interaction.reply({ embeds: [embed] });
  },
};
