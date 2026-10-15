import { Colors, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types.ts';
import { NO_REASON, auditReason, hierarchyProblem } from '../../lib/moderation.ts';
import { logModAction } from '../../lib/modlog.ts';
import { replyEphemeral } from '../../lib/reply.ts';

const DELETE_MESSAGES = [
  { name: 'Не удалять', value: 0 },
  { name: 'За последний час', value: 60 * 60 },
  { name: 'За последние сутки', value: 24 * 60 * 60 },
  { name: 'За последние 7 дней', value: 7 * 24 * 60 * 60 },
];

export const ban: Command = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Забанить пользователя (можно и того, кого уже нет на сервере)')
    .addUserOption((option) => option.setName('user').setDescription('Кого забанить').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Причина').setMaxLength(400))
    .addIntegerOption((option) =>
      option.setName('delete_messages').setDescription('Удалить недавние сообщения пользователя').addChoices(...DELETE_MESSAGES),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const target = interaction.options.getUser('user', true);
    const member = interaction.options.getMember('user');
    const reason = interaction.options.getString('reason') ?? NO_REASON;
    const deleteMessageSeconds = interaction.options.getInteger('delete_messages') ?? 0;

    // Проверки ролей имеют смысл, только если человек сейчас на сервере.
    if (member) {
      const problem = hierarchyProblem(interaction.member, member);
      if (problem) return replyEphemeral(interaction, problem);
      if (!member.bannable) {
        return replyEphemeral(interaction, 'Не могу: моя роль должна быть выше роли участника и иметь право «Банить участников».');
      }
    }

    await interaction.guild.members.ban(target, { reason: auditReason(interaction, reason), deleteMessageSeconds });
    await interaction.reply(`🔨 Пользователь **${target.tag}** забанен. Причина: ${reason}`);
    await logModAction(interaction.guild, {
      title: '🔨 Бан',
      color: Colors.Red,
      moderator: interaction.user,
      target,
      reason,
      details: DELETE_MESSAGES.find((choice) => choice.value === deleteMessageSeconds)?.name,
    });
  },
};
