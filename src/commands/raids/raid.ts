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
import { fetchRaidChannel, scheduledRaid } from '../../raids/scheduler.ts';
import { nextRaid, scheduleKey } from '../../raids/slots.ts';
import { RAID_PUBLISH_PERMISSIONS, messageSignups, publishRaid, raidUrl, raidWhen, refreshRaidMessage, shortDate } from '../../raids/service.ts';
import { getRaid, listRaids, scheduleKeyExists, setRaidStart, setRaidStatus } from '../../raids/store.ts';
import { syncRaidEventLater } from '../../raids/events.ts';
import { settings } from '../../settings.ts';
import { startRaidWizard } from '../../raids/wizard.ts';

export const raid: Command = {
  data: new SlashCommandBuilder()
    .setName('raid')
    .setDescription('Реги на рейды')
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Создать регу по шагам в личке: название, описание, дата, время, картинка')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Куда опубликовать (по умолчанию — сюда)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        )
        .addIntegerOption((o) => o.setName('size').setDescription('Мест в основном составе (по умолчанию — из настроек бота)').setMinValue(1).setMaxValue(100))
        .addRoleOption((o) => o.setName('ping').setDescription('Какую роль упомянуть при публикации (например, @Рейдер)')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('quick')
        .setDescription('Создать регу одной командой, без лички')
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
      sub
        .setName('move')
        .setDescription('Перенести рейд на другую дату или время (записавшимся придёт сообщение)')
        .addStringOption((o) => o.setName('raid').setDescription('Какую регу').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName('date').setDescription('Новая дата: сегодня, завтра, 17.10 (по умолчанию — та же)'))
        .addStringOption((o) => o.setName('time').setDescription('Новое время, например 21:00 (по умолчанию — то же)')),
    )
    .addSubcommand((sub) =>
      sub.setName('open-now').setDescription('Сразу открыть реги по расписанию шаблонов на ближайшие рейды, не дожидаясь времени открытия'),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'create') await create(interaction);
    else if (sub === 'quick') await quick(interaction);
    else if (sub === 'cancel') await cancel(interaction);
    else if (sub === 'move') await move(interaction);
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

/** Канал публикации из параметра (или текущий) — если у бота там есть все нужные права. */
async function targetChannel(interaction: ChatInputCommandInteraction<'cached'>): Promise<GuildTextBasedChannel | null> {
  const channel = (interaction.options.getChannel('channel') as GuildTextBasedChannel | null) ?? interaction.channel;
  if (!channel) {
    await replyEphemeral(interaction, 'Не вижу канал для публикации.');
    return null;
  }
  const me = interaction.guild.members.me ?? (await interaction.guild.members.fetchMe());
  if (!channel.permissionsFor(me).has(RAID_PUBLISH_PERMISSIONS)) {
    await replyEphemeral(interaction, `В ${channel} мне нужны права: видеть канал, отправлять сообщения, встраивать ссылки и прикреплять файлы.`);
    return null;
  }
  return channel;
}

/** Как в Raid-Helper: дальше бот спрашивает всё по шагам в личке. */
async function create(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const channel = await targetChannel(interaction);
  if (!channel) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const started = await startRaidWizard(interaction.user, {
    userId: interaction.user.id,
    guildId: interaction.guild.id,
    channelId: channel.id,
    pingRoleId: interaction.options.getRole('ping')?.id ?? null,
    size: interaction.options.getInteger('size') ?? getSettings().raids.defaultSize,
    leaderName: interaction.member.displayName,
  });
  if (!started.ok) {
    await interaction.editReply(
      '📪 Не могу написать тебе в личку. Разреши личные сообщения от участников сервера (ПКМ по иконке сервера → Настройки конфиденциальности) или создай регу одной командой: `/raid quick`.',
    );
    return;
  }
  await interaction.editReply(
    `📩 Продолжим в личке: ${started.url}\nРега появится в ${channel} после «Опубликовать».${started.replaced ? '\nПрошлый незаконченный черновик заменён.' : ''}`,
  );
}

async function quick(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const title = interaction.options.getString('title', true);
  const dateText = interaction.options.getString('date') ?? 'сегодня';
  const timeText = interaction.options.getString('time') ?? getSettings().raids.defaultTime;
  const date = parseDate(dateText);
  const startTime = parseTime(timeText);
  if (!date) return replyEphemeral(interaction, `Не понял дату «${dateText}». Примеры: сегодня, завтра, 17.10, 17.10.2026.`);
  if (!startTime) return replyEphemeral(interaction, `Не понял время «${timeText}». Пример: 20:00.`);

  const startsAt = toEpochMs(date, startTime);
  if (startsAt <= Date.now()) return replyEphemeral(interaction, 'Это время уже прошло — укажи будущее.');

  const channel = await targetChannel(interaction);
  if (!channel) return;

  // Публикация с картинкой может занять больше 3 секунд — сначала «бот думает…».
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const created = await publishRaid(channel, {
    title,
    description: interaction.options.getString('description'),
    startsAt,
    size: interaction.options.getInteger('size') ?? getSettings().raids.defaultSize,
    createdBy: interaction.user.id,
    leaderName: interaction.member.displayName,
  }, [interaction.options.getRole('ping')?.id].filter((id) => id !== undefined));
  await interaction.editReply(`✅ Рега #${created.id} создана в ${channel}: ${raidUrl(created)}`);
}

async function cancel(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const target = getRaid(Number(interaction.options.getString('raid', true)));
  if (!target || target.guildId !== interaction.guild.id) return replyEphemeral(interaction, 'Такая рега не найдена.');
  if (target.status !== 'open') return replyEphemeral(interaction, 'Эта рега уже закрыта или отменена.');

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  setRaidStatus(target.id, 'cancelled');
  await refreshRaidMessage(interaction.client, target.id);
  syncRaidEventLater(interaction.client, target.id);
  await messageSignups(interaction.client, target, () => `${uiEmoji('leave')} Рейд **${target.title}**, который должен был начаться ${raidWhen(target)}, отменён.`);
  await interaction.editReply(`🚫 Рега #${target.id} «${target.title}» отменена, записавшимся отправлено сообщение.`);
}

/** Перенос рейда: новое время на реге и в событии Discord, напоминания — заново, записавшимся — сообщение. */
async function move(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const target = getRaid(Number(interaction.options.getString('raid', true)));
  if (!target || target.guildId !== interaction.guild.id) return replyEphemeral(interaction, 'Такая рега не найдена.');
  if (target.status !== 'open') return replyEphemeral(interaction, 'Эта рега уже закрыта или отменена.');
  const dateText = interaction.options.getString('date');
  const timeText = interaction.options.getString('time');
  if (!dateText && !timeText) return replyEphemeral(interaction, 'Укажи новую дату (`date`) или время (`time`).');

  const current = Temporal.Instant.fromEpochMilliseconds(target.startsAt).toZonedDateTimeISO(settings.timeZone);
  const date = dateText ? parseDate(dateText) : current.toPlainDate();
  const startTime = timeText ? parseTime(timeText) : current.toPlainTime();
  if (!date) return replyEphemeral(interaction, `Не понял дату «${dateText}». Примеры: сегодня, завтра, 17.10, 17.10.2026.`);
  if (!startTime) return replyEphemeral(interaction, `Не понял время «${timeText}». Пример: 20:00.`);
  const startsAt = toEpochMs(date, startTime);
  if (startsAt <= Date.now()) return replyEphemeral(interaction, 'Это время уже прошло — укажи будущее.');
  if (startsAt === target.startsAt) return replyEphemeral(interaction, 'Рейд и так в это время.');

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  setRaidStart(target.id, startsAt);
  const moved = { ...target, startsAt };
  await refreshRaidMessage(interaction.client, target.id);
  syncRaidEventLater(interaction.client, target.id);
  await messageSignups(interaction.client, moved, () => `${uiEmoji('time')} Рейд **${target.title}** перенесён: теперь начало ${raidWhen(moved)}. [Открыть регу](${raidUrl(moved)})`);
  await interaction.editReply(`🕗 Рега #${target.id} «${target.title}» перенесена на ${raidWhen(moved)}, записавшимся отправлено сообщение.`);
}

/** Сразу открывает реги по расписанию шаблонов — на ближайший рейд по каждой строке, если рега на него ещё не открыта. */
async function openNow(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const templates = getSettings().raidTemplates.filter((template) => template.channelId && template.slots.length);
  if (!templates.length) {
    return replyEphemeral(interaction, 'Расписаний нет: в админке на странице «Рейды» выбери у шаблона канал и добавь дни рейдов.');
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const now = nowZoned();
  const lines: string[] = [];
  for (const template of templates) {
    const channel = await fetchRaidChannel(interaction.client, template.channelId ?? '');
    if (!channel) {
      lines.push(`⚠️ «${template.title}»: канал недоступен — проверь шаблон.`);
      continue;
    }
    for (const slot of template.slots) {
      const next = nextRaid(now, slot);
      if (!next) continue;
      const key = scheduleKey(template.id, next.date);
      if (scheduleKeyExists(key)) {
        lines.push(`• «${template.title}» на ${shortDate(next.startsAt)} уже открыта.`);
        continue;
      }
      const created = await publishRaid(channel, scheduledRaid(template, next.startsAt, key, interaction.member.displayName), template.pingRoleIds);
      lines.push(`✅ «${created.title}» на ${shortDate(created.startsAt)} → ${channel}: ${raidUrl(created)}`);
    }
  }
  await interaction.editReply(lines.join('\n').slice(0, 2000) || 'Нечего открывать.');
}
