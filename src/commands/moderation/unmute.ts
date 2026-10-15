import { Colors, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types.ts';
import { NO_REASON, auditReason, hierarchyProblem } from '../../lib/moderation.ts';
import { logModAction } from '../../lib/modlog.ts';
import { replyEphemeral } from '../../lib/reply.ts';

export const unmute: Command = {
  data: new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Снять с участника тайм-аут досрочно')
    .addUserOption((option) => option.setName('user').setDescription('С кого снять').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Причина').setMaxLength(400))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const target = interaction.options.getMember('user');
    const reason = interaction.options.getString('reason') ?? NO_REASON;

    if (!target) return replyEphemeral(interaction, 'Этого пользователя нет на сервере.');
    if (!target.isCommunicationDisabled()) return replyEphemeral(interaction, 'У этого участника нет мута.');
    const problem = hierarchyProblem(interaction.member, target);
    if (problem) return replyEphemeral(interaction, problem);
    if (!target.moderatable) return replyEphemeral(interaction, 'Не могу: моя роль должна быть выше роли участника.');

    await target.timeout(null, auditReason(interaction, reason));
    await interaction.reply(`🔊 С участника **${target.user.tag}** снят мут.`);
    await logModAction(interaction.guild, {
      title: '🔊 Снятие мута',
      color: Colors.Green,
      moderator: interaction.user,
      target: target.user,
      reason,
    });
  },
};
