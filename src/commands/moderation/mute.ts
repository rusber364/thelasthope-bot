import { Colors, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder, TimestampStyles, time } from 'discord.js';
import type { Command } from '../../types.ts';
import { NO_REASON, auditReason, hierarchyProblem } from '../../lib/moderation.ts';
import { logModAction } from '../../lib/modlog.ts';
import { replyEphemeral } from '../../lib/reply.ts';

// Мут — это встроенный в Discord «тайм-аут»: участник не может писать, говорить и ставить реакции.
// Максимум, который разрешает Discord, — 28 дней.
const DURATIONS = [
  { name: '5 минут', value: 5 },
  { name: '10 минут', value: 10 },
  { name: '30 минут', value: 30 },
  { name: '1 час', value: 60 },
  { name: '6 часов', value: 6 * 60 },
  { name: '1 день', value: 24 * 60 },
  { name: '1 неделя', value: 7 * 24 * 60 },
];

export const mute: Command = {
  data: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Выдать участнику тайм-аут (запрет писать и говорить)')
    .addUserOption((option) => option.setName('user').setDescription('Кому').setRequired(true))
    .addIntegerOption((option) =>
      option.setName('duration').setDescription('На сколько').setRequired(true).addChoices(...DURATIONS),
    )
    .addStringOption((option) => option.setName('reason').setDescription('Причина').setMaxLength(400))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const target = interaction.options.getMember('user');
    const minutes = interaction.options.getInteger('duration', true);
    const reason = interaction.options.getString('reason') ?? NO_REASON;
    const durationName = DURATIONS.find((choice) => choice.value === minutes)?.name ?? `${minutes} мин.`;

    if (!target) return replyEphemeral(interaction, 'Этого пользователя нет на сервере.');
    const problem = hierarchyProblem(interaction.member, target);
    if (problem) return replyEphemeral(interaction, problem);
    if (!target.moderatable) {
      return replyEphemeral(
        interaction,
        'Не могу: моя роль должна быть выше роли участника и иметь право «Отправлять участников подумать». Администраторов замутить нельзя.',
      );
    }

    await target.timeout(minutes * 60 * 1000, auditReason(interaction, reason));
    const until = time(new Date(Date.now() + minutes * 60 * 1000), TimestampStyles.RelativeTime);
    await interaction.reply(`🔇 Участнику **${target.user.tag}** выдан мут на ${durationName} (закончится ${until}). Причина: ${reason}`);
    await logModAction(interaction.guild, {
      title: '🔇 Мут',
      color: Colors.Yellow,
      moderator: interaction.user,
      target: target.user,
      reason,
      details: `Длительность: ${durationName}`,
    });
  },
};
