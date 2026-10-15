import {
  ChannelType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildTextBasedChannel,
} from 'discord.js';
import type { Command } from '../../types.ts';
import { getSettings } from '../../botSettings.ts';
import { replyEphemeral } from '../../lib/reply.ts';
import { nowZoned, parseDate, parseTime, toEpochMs } from '../../lib/time.ts';
import { uiEmoji } from '../../raids/emojis.ts';
import { fetchRaidChannel } from '../../raids/scheduler.ts';
import { messageSignups, publishRaid, raidUrl, raidWhen, refreshRaidMessage, shortDate } from '../../raids/service.ts';
import { getRaid, listRaids, setRaidStatus } from '../../raids/store.ts';

const NEEDED_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
];

export const raid: Command = {
  data: new SlashCommandBuilder()
    .setName('raid')
    .setDescription('Реги на рейды')
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Создать регу в любом канале')
        .addStringOption((o) => o.setName('title').setDescription('Название, например «Огненные Недра»').setRequired(true).setMaxLength(100))
        .addStringOption((o) => o.setName('date').setDescription('Дата: сегодня, завтра, 17.10 или 17.10.2026 (по умолчанию — сегодня)'))
        .addStringOption((o) => o.setName('time').setDescription('Время начала, например 20:00 (по умолчанию — из настроек бота)'))
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Куда опубликовать (по умолчанию — сюда)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        )
        .addIntegerOption((o) => o.setName('size').setDescription('Мест в основном составе (по умолчанию — из настроек бота)').setMinValue(1).setMaxValue(100))
        .addStringOption((o) => o.setName('description').setDescription('Подробности: сбор, требования и т.п.').setMaxLength(500))
        .addRoleOption((o) => o.setName('ping').setDescription('Какую роль упомянуть при публикации (например, @Рейдер)')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('cancel')
        .setDescription('Отменить регу (записавшимся придёт сообщение)')
        .addStringOption((o) => o.setName('raid').setDescription('Какую регу').setRequired(true).setAutocomplete(true)),
    )
    .addSubcommand((sub) =>
      sub.setName('open-now').setDescription('Сразу открыть реги по расписанию — для проверки, не дожидаясь полуночи'),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'create') await create(interaction);
    else if (sub === 'cancel') await cancel(interaction);
    else if (sub === 'open-now') await openNow(interaction);
  },

  async autocomplete(interaction) {
    const typed = interaction.options.getFocused().toLowerCase();
    const choices = listRaids(interaction.guild.id, 'open')
      .map((r) => ({ name: `#${r.id} · ${r.title} · ${shortDate(r.startsAt)}`.slice(0, 100), value: String(r.id) }))
      .filter((choice) => choice.name.toLowerCase().includes(typed));
    await interaction.respond(choices.slice(0, 25));
  },
};

async function create(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const title = interaction.options.getString('title', true);
  const dateText = interaction.options.getString('date') ?? 'сегодня';
  const timeText = interaction.options.getString('time') ?? getSettings().raids.defaultTime;
  const date = parseDate(dateText);
  const startTime = parseTime(timeText);
  if (!date) return replyEphemeral(interaction, `Не понял дату «${dateText}». Примеры: сегодня, завтра, 17.10, 17.10.2026.`);
  if (!startTime) return replyEphemeral(interaction, `Не понял время «${timeText}». Пример: 20:00.`);

  const startsAt = toEpochMs(date, startTime);
  if (startsAt <= Date.now()) return replyEphemeral(interaction, 'Это время уже прошло — укажи будущее.');

  const channel = (interaction.options.getChannel('channel') as GuildTextBasedChannel | null) ?? interaction.channel;
  if (!channel) return replyEphemeral(interaction, 'Не вижу канал для публикации.');
  const me = interaction.guild.members.me ?? (await interaction.guild.members.fetchMe());
  if (!channel.permissionsFor(me).has(NEEDED_PERMISSIONS)) {
    return replyEphemeral(interaction, `В ${channel} мне нужны права: видеть канал, отправлять сообщения, встраивать ссылки и прикреплять файлы.`);
  }

  // Публикация с картинкой может занять больше 3 секунд — сначала «бот думает…».
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const created = await publishRaid(channel, {
    title,
    description: interaction.options.getString('description'),
    startsAt,
    size: interaction.options.getInteger('size') ?? getSettings().raids.defaultSize,
    createdBy: interaction.user.id,
    leaderName: interaction.member.displayName,
  }, interaction.options.getRole('ping')?.id ?? null);
  await interaction.editReply(`✅ Рега #${created.id} создана в ${channel}: ${raidUrl(created)}`);
}

async function cancel(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const target = getRaid(Number(interaction.options.getString('raid', true)));
  if (!target || target.guildId !== interaction.guild.id) return replyEphemeral(interaction, 'Такая рега не найдена.');
  if (target.status !== 'open') return replyEphemeral(interaction, 'Эта рега уже закрыта или отменена.');

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  setRaidStatus(target.id, 'cancelled');
  await refreshRaidMessage(interaction.client, target.id);
  await messageSignups(interaction.client, target, () => `${uiEmoji('leave')} Рейд **${target.title}**, который должен был начаться ${raidWhen(target)}, отменён.`);
  await interaction.editReply(`🚫 Рега #${target.id} «${target.title}» отменена, записавшимся отправлено сообщение.`);
}

/** Для проверки: создаёт реги из расписания прямо сейчас — на сегодня (или завтра, если время уже прошло). */
async function openNow(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const { raids } = getSettings();
  const schedules = raids.schedules.filter((schedule) => schedule.channelId);
  if (!schedules.length) {
    return replyEphemeral(interaction, 'Каналы для автоматических рег не заданы: выбери их в админке на странице «Расписание рег».');
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const lines: string[] = [];
  for (const schedule of schedules) {
    const raidTime = parseTime(schedule.raidTime);
    const channel = await fetchRaidChannel(interaction.client, schedule.channelId ?? '');
    if (!raidTime || !channel) {
      lines.push(`⚠️ «${schedule.title}»: проверь время и канал в настройках.`);
      continue;
    }
    let date = nowZoned().toPlainDate();
    if (toEpochMs(date, raidTime) <= Date.now()) date = date.add({ days: 1 });

    const created = await publishRaid(channel, {
      title: schedule.title,
      startsAt: toEpochMs(date, raidTime),
      size: raids.defaultSize,
      createdBy: interaction.user.id,
      leaderName: interaction.member.displayName,
    }, schedule.pingRoleId);
    lines.push(`✅ «${created.title}» → ${channel}: ${raidUrl(created)}`);
  }
  await interaction.editReply(lines.join('\n'));
}
