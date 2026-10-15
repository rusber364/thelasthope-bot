import {
  Colors,
  DiscordAPIError,
  InteractionContextType,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
  SlashCommandBuilder,
} from 'discord.js';
import type { Command } from '../../types.ts';
import { NO_REASON, auditReason } from '../../lib/moderation.ts';
import { logModAction } from '../../lib/modlog.ts';
import { replyEphemeral } from '../../lib/reply.ts';

export const unban: Command = {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Снять бан с пользователя')
    .addStringOption((option) =>
      option.setName('user_id').setDescription('ID пользователя (есть в журнале аудита или в списке банов)').setRequired(true),
    )
    .addStringOption((option) => option.setName('reason').setDescription('Причина').setMaxLength(400))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const userId = interaction.options.getString('user_id', true).trim();
    const reason = interaction.options.getString('reason') ?? NO_REASON;

    if (!/^\d{17,20}$/.test(userId)) return replyEphemeral(interaction, 'Это не похоже на ID пользователя: нужно 17–20 цифр.');

    try {
      const user = await interaction.guild.members.unban(userId, auditReason(interaction, reason));
      const name = user?.tag ?? userId;
      await interaction.reply(`✅ С пользователя **${name}** снят бан.`);
      await logModAction(interaction.guild, {
        title: '✅ Разбан',
        color: Colors.Green,
        moderator: interaction.user,
        target: user ?? undefined,
        reason,
        details: user ? undefined : `ID: ${userId}`,
      });
    } catch (error) {
      if (error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownBan) {
        return replyEphemeral(interaction, 'Этот пользователь не забанен.');
      }
      throw error;
    }
  },
};
