import { Colors, InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types.ts';
import { logModAction } from '../../lib/modlog.ts';
import { replyEphemeral } from '../../lib/reply.ts';

export const clear: Command = {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Удалить последние сообщения в этом канале')
    .addIntegerOption((option) =>
      option.setName('amount').setDescription('Сколько сообщений (1–100)').setRequired(true).setMinValue(1).setMaxValue(100),
    )
    .addUserOption((option) => option.setName('user').setDescription('Удалить только сообщения этого пользователя'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const amount = interaction.options.getInteger('amount', true);
    const author = interaction.options.getUser('user');
    const { channel } = interaction;

    if (!channel) return replyEphemeral(interaction, 'Не вижу этот канал.');
    // appPermissions — права самого бота в канале, где вызвали команду.
    if (!interaction.appPermissions.has([PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory])) {
      return replyEphemeral(interaction, 'Мне нужны права «Управлять сообщениями» и «Читать историю сообщений» в этом канале.');
    }

    // deferReply = «бот думает…». Даёт до 15 минут на ответ вместо обычных 3 секунд.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Без фильтра — просто N последних сообщений. С фильтром — берём 100 последних
    // и оставляем из них N самых новых от нужного автора.
    const toDelete = author
      ? (await channel.messages.fetch({ limit: 100 })).filter((message) => message.author.id === author.id).first(amount)
      : amount;

    // true = молча пропускать сообщения старше 14 дней: Discord не даёт удалять их пачкой.
    const deleted = await channel.bulkDelete(toDelete, true);
    const note = deleted.size < amount ? ' Сообщения старше 14 дней пачкой удалить нельзя.' : '';
    await interaction.editReply(`🧹 Удалено сообщений: ${deleted.size}.${note}`);

    await logModAction(interaction.guild, {
      title: '🧹 Очистка сообщений',
      color: Colors.Blurple,
      moderator: interaction.user,
      target: author ?? undefined,
      details: `Канал: ${channel}, удалено: ${deleted.size}`,
    });
  },
};
