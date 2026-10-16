import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Colors,
  EmbedBuilder,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type Role,
} from 'discord.js';
import type { Command } from '../../types.ts';
import { ROLE_BUTTON_PREFIX, roleButtonProblem } from '../../lib/roleButtons.ts';
import { replyEphemeral } from '../../lib/reply.ts';
import { formatDuration } from '../../lib/time.ts';

const ROLE_OPTIONS = ['role1', 'role2', 'role3', 'role4', 'role5'];

export const rolepanel: Command = {
  data: new SlashCommandBuilder()
    .setName('rolepanel')
    .setDescription('Создать сообщение с кнопками, по которым участники сами берут роли')
    .addStringOption((option) => option.setName('title').setDescription('Заголовок панели').setRequired(true).setMaxLength(256))
    .addRoleOption((option) => option.setName('role1').setDescription('Роль 1').setRequired(true))
    .addRoleOption((option) => option.setName('role2').setDescription('Роль 2'))
    .addRoleOption((option) => option.setName('role3').setDescription('Роль 3'))
    .addRoleOption((option) => option.setName('role4').setDescription('Роль 4'))
    .addRoleOption((option) => option.setName('role5').setDescription('Роль 5'))
    .addStringOption((option) => option.setName('description').setDescription('Текст под заголовком').setMaxLength(1000))
    .addIntegerOption((option) => option.setName('hours').setDescription('Роль на время: через сколько часов снимется сама (пусто — навсегда)').setMinValue(1).setMaxValue(720))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const title = interaction.options.getString('title', true);
    const description = interaction.options.getString('description') ?? 'Нажми кнопку, чтобы взять роль. Нажми ещё раз — чтобы снять.';
    const hours = interaction.options.getInteger('hours');

    // Собираем выбранные роли без повторов.
    const roles = new Map<string, Role>();
    for (const name of ROLE_OPTIONS) {
      const role = interaction.options.getRole(name);
      if (role) roles.set(role.id, role);
    }

    // Проверяем каждую роль: может ли бот её выдавать и не выше ли она роли самого модератора
    // (иначе модератор мог бы через панель раздать роль, которую сам выдать не вправе).
    const isOwner = interaction.user.id === interaction.guild.ownerId;
    const problems: string[] = [];
    for (const role of roles.values()) {
      const problem = roleButtonProblem(role);
      if (problem) problems.push(problem);
      else if (!isOwner && role.comparePositionTo(interaction.member.roles.highest) >= 0) {
        problems.push(`Роль ${role} не ниже твоей самой высокой роли.`);
      }
    }
    if (problems.length) return replyEphemeral(interaction, `Не получится создать панель:\n• ${problems.join('\n• ')}`);

    const { channel } = interaction;
    if (!channel) return replyEphemeral(interaction, 'Не вижу этот канал.');
    const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
    if (!interaction.appPermissions.has(needed)) {
      return replyEphemeral(interaction, 'Мне нужны права «Видеть канал», «Отправлять сообщения» и «Встраивать ссылки» здесь.');
    }

    const embed = new EmbedBuilder()
      .setColor(Colors.Blurple)
      .setTitle(title)
      .setDescription(
        [
          description,
          ...(hours ? [`-# Роль выдаётся на ${formatDuration(hours * 60 * 60 * 1000)} и потом снимается сама.`] : []),
          '',
          ...[...roles.values()].map((role) => `• ${role}`),
        ].join('\n'),
      );

    // Срок роли — в самой кнопке (role:<id>:<часы>), чтобы панель работала и после перезапуска бота.
    const buttons = [...roles.values()].map((role) =>
      new ButtonBuilder()
        .setCustomId(ROLE_BUTTON_PREFIX + role.id + (hours ? `:${hours}` : ''))
        .setLabel(role.name.slice(0, 80))
        .setStyle(ButtonStyle.Secondary),
    );
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);

    // Панель — отдельное сообщение в канале, а не ответ на команду: так она выглядит аккуратнее.
    await channel.send({ embeds: [embed], components: [row] });
    await replyEphemeral(interaction, '✅ Панель ролей создана.');
  },
};
