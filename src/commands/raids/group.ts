// /group — группы, которые игроки открывают сами: подземелья и PvP. Запись, запас, лимиты и напоминания — как у рег офицеров.
// Свою группу игрок может отменить, перенести и поменять места; офицеры (право «Управлять событиями») — любую регу, и рейды тоже.
import {
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type SlashCommandStringOption,
} from 'discord.js';
import type { Command } from '../../types.ts';
import { PLAYER_GROUP_KINDS, getSettings, limitErrors, type PlayerGroupKind } from '../../botSettings.ts';
import { replyEphemeral } from '../../lib/reply.ts';
import { parseDate, parseTime, toEpochMs } from '../../lib/time.ts';
import { canManage, createProblem, parseLimit } from '../../raids/groups.ts';
import { KINDS, LIMIT_GROUPS, type LimitGroup } from '../../raids/kinds.ts';
import { kindNote } from '../../raids/render.ts';
import { fetchRaidChannel } from '../../raids/scheduler.ts';
import { RAID_PUBLISH_PERMISSIONS, cancelRaid, moveRaid, newStart, publishRaid, raidUrl, raidWhen, refreshRaidMessage, shortDate } from '../../raids/service.ts';
import { getRaid, listRaids, setRaidLimits, type Raid } from '../../raids/store.ts';

const LIMIT_OPTIONS: Record<LimitGroup, string> = { tank: 'tanks', healer: 'healers', dps: 'dps' };

const raidOption = (o: SlashCommandStringOption) =>
  o.setName('group').setDescription('Какую группу или регу').setRequired(true).setAutocomplete(true);

export const group: Command = {
  data: new SlashCommandBuilder()
    .setName('group')
    .setDescription('Группы в подземелье и PvP: открыть свою, отменить, перенести, поменять места')
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Открыть группу: подземелье или PvP — бот опубликует регу в канале групп')
        .addStringOption((o) =>
          o
            .setName('kind')
            .setDescription('Подземелье (5 мест: 1 танк, 1 лекарь, 3 бойца) или PvP (10 мест)')
            .setRequired(true)
            .addChoices(...PLAYER_GROUP_KINDS.map((kind) => ({ name: KINDS[kind].title, value: kind }))),
        )
        .addStringOption((o) => o.setName('title').setDescription('Куда идём, например «Мёртвые копи» или «Арена 5×5»').setRequired(true).setMaxLength(100))
        .addStringOption((o) => o.setName('time').setDescription('Время начала, например 21:00').setRequired(true))
        .addStringOption((o) => o.setName('date').setDescription('Дата: сегодня, завтра, 17.10 (по умолчанию — сегодня)'))
        .addIntegerOption((o) => o.setName('size').setDescription('Мест в группе (по умолчанию — из настроек вида)').setMinValue(1).setMaxValue(40))
        .addStringOption((o) => o.setName('note').setDescription('Подробности: ключ, уровень, что нужно').setMaxLength(300)),
    )
    .addSubcommand((sub) => sub.setName('cancel').setDescription('Отменить свою группу (записавшимся придёт сообщение)').addStringOption(raidOption))
    .addSubcommand((sub) =>
      sub
        .setName('move')
        .setDescription('Перенести свою группу на другое время (записавшимся придёт сообщение)')
        .addStringOption(raidOption)
        .addStringOption((o) => o.setName('date').setDescription('Новая дата: сегодня, завтра, 17.10 (по умолчанию — та же)'))
        .addStringOption((o) => o.setName('time').setDescription('Новое время, например 21:30 (по умолчанию — то же)')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('limits')
        .setDescription('Поменять число мест и лимиты по ролям — например, второй лекарь')
        .addStringOption(raidOption)
        .addIntegerOption((o) => o.setName('size').setDescription('Мест в основе').setMinValue(1).setMaxValue(100))
        .addStringOption((o) => o.setName('tanks').setDescription('Танков: число или «нет» — без лимита'))
        .addStringOption((o) => o.setName('healers').setDescription('Лекарей: число или «нет» — без лимита'))
        .addStringOption((o) => o.setName('dps').setDescription('Бойцов (ближний и дальний бой): число или «нет» — без лимита')),
    )
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'create') await create(interaction);
    else if (sub === 'cancel') await cancel(interaction);
    else if (sub === 'move') await move(interaction);
    else if (sub === 'limits') await limits(interaction);
  },

  async autocomplete(interaction) {
    const typed = interaction.options.getFocused().toLowerCase();
    const officer = interaction.memberPermissions.has(PermissionFlagsBits.ManageEvents);
    const choices = listRaids(interaction.guild.id, 'open')
      .filter((r) => canManage(r, interaction.user.id, officer))
      .map((r) => ({ name: `#${r.id} · ${r.title} · ${KINDS[r.kind].title} · ${shortDate(r.startsAt)}`.slice(0, 100), value: String(r.id) }))
      .filter((choice) => choice.name.toLowerCase().includes(typed));
    await interaction.respond(choices.slice(0, 25));
  },
};

async function create(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const kind = interaction.options.getString('kind', true) as PlayerGroupKind;
  if (!PLAYER_GROUP_KINDS.includes(kind)) return replyEphemeral(interaction, 'Такого вида групп нет.');
  const settings = getSettings().groups[kind];
  const problem = createProblem(settings, KINDS[kind].title, new Set(interaction.member.roles.cache.keys()));
  if (problem) return replyEphemeral(interaction, problem);

  const dateText = interaction.options.getString('date') ?? 'сегодня';
  const timeText = interaction.options.getString('time', true);
  const date = parseDate(dateText);
  const startTime = parseTime(timeText);
  if (!date) return replyEphemeral(interaction, `Не понял дату «${dateText}». Примеры: сегодня, завтра, 17.10, 17.10.2026.`);
  if (!startTime) return replyEphemeral(interaction, `Не понял время «${timeText}». Пример: 21:00.`);
  const startsAt = toEpochMs(date, startTime);
  if (startsAt <= Date.now()) return replyEphemeral(interaction, 'Это время уже прошло — укажи будущее.');

  const size = interaction.options.getInteger('size') ?? settings.size;
  const errors = limitErrors('Группа', settings.limits, size);
  if (errors.length) return replyEphemeral(interaction, `Мест меньше, чем лимитов по ролям (${describeLimits(settings.limits)}) — укажи больше мест.`);

  const channel = await fetchRaidChannel(interaction.client, settings.channelId ?? '');
  const me = interaction.guild.members.me ?? (await interaction.guild.members.fetchMe());
  if (!channel || !channel.permissionsFor(me)?.has(RAID_PUBLISH_PERMISSIONS)) {
    return replyEphemeral(interaction, 'Не могу писать в канал групп — попроси офицеров проверить права бота в этом канале.');
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const created = await publishRaid(
    channel,
    {
      title: interaction.options.getString('title', true),
      description: interaction.options.getString('note'),
      startsAt,
      size,
      createdBy: interaction.user.id,
      leaderName: interaction.member.displayName,
      kind,
      limits: settings.limits,
      player: true,
    },
    [],
  );
  await interaction.editReply(
    `✅ Группа открыта в ${channel}: ${raidUrl(created)}\n-# Отменить, перенести или поменять места: \`/group cancel\`, \`/group move\`, \`/group limits\`.`,
  );
}

/** Рега из параметра, которой этот участник может управлять (иначе ответ с причиной и null). */
async function managedRaid(interaction: ChatInputCommandInteraction<'cached'>): Promise<Raid | null> {
  const raid = getRaid(Number(interaction.options.getString('group', true)));
  if (!raid || raid.guildId !== interaction.guild.id) {
    await replyEphemeral(interaction, 'Такая группа не найдена.');
    return null;
  }
  if (!canManage(raid, interaction.user.id, interaction.memberPermissions.has(PermissionFlagsBits.ManageEvents))) {
    await replyEphemeral(interaction, 'Это не твоя группа: менять её может тот, кто открыл, или офицеры.');
    return null;
  }
  if (raid.status !== 'open') {
    await replyEphemeral(interaction, 'Эта рега уже закрыта или отменена.');
    return null;
  }
  return raid;
}

async function cancel(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const raid = await managedRaid(interaction);
  if (!raid) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await cancelRaid(interaction.client, raid);
  await interaction.editReply(`🚫 «${raid.title}» отменили, записавшимся отправлено сообщение.`);
}

async function move(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const raid = await managedRaid(interaction);
  if (!raid) return;
  const start = newStart(raid, interaction.options.getString('date'), interaction.options.getString('time'));
  if ('error' in start) return replyEphemeral(interaction, start.error);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const moved = await moveRaid(interaction.client, raid, start.startsAt);
  await interaction.editReply(`🕗 «${raid.title}» теперь ${raidWhen(moved)}, записавшимся отправлено сообщение.`);
}

async function limits(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const raid = await managedRaid(interaction);
  if (!raid) return;
  const size = interaction.options.getInteger('size') ?? raid.size;
  const next = { ...raid.limits };
  let changed = size !== raid.size;
  for (const { group, title } of LIMIT_GROUPS) {
    const change = parseLimit(interaction.options.getString(LIMIT_OPTIONS[group]), title);
    if ('error' in change) return replyEphemeral(interaction, change.error);
    if (change.change) {
      next[group] = change.value;
      changed = true;
    }
  }
  if (!changed) return replyEphemeral(interaction, 'Укажи, что поменять: `size`, `tanks`, `healers` или `dps`.');
  const errors = limitErrors(`«${raid.title}»`, next, size);
  if (errors.length) return replyEphemeral(interaction, errors.join('\n'));

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  setRaidLimits(raid.id, size, next);
  // Состав пересчитывается при перерисовке: кто подходит по роли, поднимается из запаса сам.
  await refreshRaidMessage(interaction.client, raid.id);
  const summary = kindNote({ kind: raid.kind, size, limits: next }) ?? `${size} мест, без лимитов по ролям`;
  await interaction.editReply(`✅ «${raid.title}»: ${summary.replaceAll('**', '')}. Рега обновлена.`);
}

function describeLimits(limits: Raid['limits']): string {
  return LIMIT_GROUPS.filter(({ group }) => limits[group] !== null)
    .map(({ group, title }) => `${title.toLowerCase()} ${limits[group]}`)
    .join(', ');
}
