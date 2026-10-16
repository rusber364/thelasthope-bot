import { Colors, EmbedBuilder, InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, TimestampStyles, time } from 'discord.js';
import type { Command } from '../../types.ts';
import { KIND_LABELS, attendanceRecords, summarize } from '../../raids/attendanceStats.ts';

const DAY = 24 * 60 * 60 * 1000;
const SHOWN_RAIDS = 15;

export const history: Command = {
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription('Посещаемость рейдов игрока: на рейдах, пропуски, «под вопросом»')
    .addUserOption((o) => o.setName('player').setDescription('Чья посещаемость').setRequired(true))
    .addIntegerOption((o) => o.setName('days').setDescription('За сколько последних дней (по умолчанию 30)').setMinValue(1).setMaxValue(365))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const player = interaction.options.getUser('player', true);
    const days = interaction.options.getInteger('days') ?? 30;
    const records = attendanceRecords(interaction.guild.id, Date.now() - days * DAY, Date.now(), player.id);
    const [summary] = summarize(records);

    const embed = new EmbedBuilder().setColor(Colors.Gold).setTitle(`Посещаемость: ${player.displayName}`.slice(0, 256)).setFooter({ text: `За последние ${days} дн.` });
    if (!summary) {
      embed.setDescription('За этот период отметок нет: ни записей на проверенные рейды, ни посещений без записи.');
    } else {
      embed.addFields(
        { name: 'Посещаемость', value: summary.rate === null ? '—' : `**${summary.rate}%**`, inline: true },
        { name: KIND_LABELS.present, value: String(summary.present), inline: true },
        { name: KIND_LABELS.absent, value: String(summary.absent), inline: true },
        { name: KIND_LABELS.tentativePresent, value: String(summary.tentativePresent), inline: true },
        { name: KIND_LABELS.tentativeAbsent, value: String(summary.tentativeAbsent), inline: true },
        { name: KIND_LABELS.walkin, value: String(summary.walkin), inline: true },
        {
          name: 'Последние рейды',
          value: records
            .slice(0, SHOWN_RAIDS)
            .map((r) => `${KIND_LABELS[r.kind].split(' ')[0]} ${time(new Date(r.startsAt), TimestampStyles.ShortDate)} · ${r.title}`)
            .join('\n')
            .slice(0, 1024),
        },
      );
      embed.setDescription('Посещаемость = на рейде / (на рейде + пропуски). Отметка «под вопросом» без прихода — предупреждение заранее, пропуском не считается.');
    }
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
