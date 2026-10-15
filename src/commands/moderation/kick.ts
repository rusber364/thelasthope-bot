import { Colors, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types.ts';
import { NO_REASON, auditReason, hierarchyProblem } from '../../lib/moderation.ts';
import { logModAction } from '../../lib/modlog.ts';
import { replyEphemeral } from '../../lib/reply.ts';

export const kick: Command = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Выгнать участника с сервера (сможет вернуться по приглашению)')
    .addUserOption((option) => option.setName('user').setDescription('Кого выгнать').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Причина').setMaxLength(400))
    // Кто видит команду по умолчанию. Админ сервера может поменять это в Настройках → Интеграции.
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const target = interaction.options.getMember('user');
    const reason = interaction.options.getString('reason') ?? NO_REASON;

    if (!target) return replyEphemeral(interaction, 'Этого пользователя нет на сервере.');
    const problem = hierarchyProblem(interaction.member, target);
    if (problem) return replyEphemeral(interaction, problem);
    if (!target.kickable) {
      return replyEphemeral(interaction, 'Не могу: моя роль должна быть выше роли участника и иметь право «Выгонять участников».');
    }

    await target.kick(auditReason(interaction, reason));
    await interaction.reply(`👢 Участник **${target.user.tag}** исключён с сервера. Причина: ${reason}`);
    await logModAction(interaction.guild, {
      title: '👢 Кик',
      color: Colors.Orange,
      moderator: interaction.user,
      target: target.user,
      reason,
    });
  },
};
