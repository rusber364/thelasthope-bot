import {
  ChannelType,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TimestampStyles,
  time,
  type CategoryChannel,
} from 'discord.js';
import type { Command } from '../../types.ts';
import { replyEphemeral } from '../../lib/reply.ts';
import { rememberTempChannel } from '../../lib/tempChannels.ts';
import { formatDuration } from '../../lib/time.ts';

const HOUR = 60 * 60 * 1000;

export const tempchannel: Command = {
  data: new SlashCommandBuilder()
    .setName('tempchannel')
    .setDescription('Создать временный канал — он сам удалится через заданный срок')
    .addStringOption((o) => o.setName('name').setDescription('Название, например «турнир-суббота»').setRequired(true).setMaxLength(100))
    .addIntegerOption((o) => o.setName('hours').setDescription('Через сколько часов удалить (1–720)').setRequired(true).setMinValue(1).setMaxValue(720))
    .addStringOption((o) =>
      o
        .setName('type')
        .setDescription('Какой канал (по умолчанию — текстовый)')
        .addChoices({ name: 'текстовый', value: 'text' }, { name: 'голосовой', value: 'voice' }),
    )
    .addChannelOption((o) => o.setName('category').setDescription('В какой категории (по умолчанию — там же, где эта команда)').addChannelTypes(ChannelType.GuildCategory))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    if (!interaction.appPermissions.has(PermissionFlagsBits.ManageChannels)) {
      return replyEphemeral(interaction, 'Мне нужно право «Управлять каналами», чтобы создавать временные каналы.');
    }
    const name = interaction.options.getString('name', true);
    const hours = interaction.options.getInteger('hours', true);
    const voice = interaction.options.getString('type') === 'voice';
    const category =
      (interaction.options.getChannel('category') as CategoryChannel | null) ??
      (interaction.channel && 'parent' in interaction.channel ? interaction.channel.parent : null);

    const expiresAt = Date.now() + hours * HOUR;
    const channel = await interaction.guild.channels.create({
      name,
      type: voice ? ChannelType.GuildVoice : ChannelType.GuildText,
      parent: category?.id ?? null,
      reason: `Временный канал от ${interaction.user.tag} на ${formatDuration(hours * HOUR)}`,
    });
    rememberTempChannel(interaction.guild.id, channel.id, expiresAt, interaction.user.id);

    const when = time(new Date(expiresAt), TimestampStyles.RelativeTime);
    // У голосовых каналов тоже есть свой чат — предупреждаем и там.
    await channel.send(`⏳ Это временный канал — он удалится сам ${when} (${time(new Date(expiresAt), TimestampStyles.ShortDateTime)}).`).catch(() => {});
    await replyEphemeral(interaction, `✅ Канал ${channel} создан и удалится ${when}.${voice ? ' Если там будут люди, бот подождёт, пока канал опустеет.' : ''}`);
  },
};
