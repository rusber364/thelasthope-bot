import { readFile } from 'node:fs/promises';
import {
  AttachmentBuilder,
  ChannelType,
  Colors,
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildTextBasedChannel,
} from 'discord.js';
import type { Command } from '../../types.ts';
import { replyEphemeral } from '../../lib/reply.ts';
import { download } from '../../lib/download.ts';
import { parsePollFile } from '../../polls/format.ts';
import { buildResultsCsv, buildResultsText } from '../../polls/render.ts';
import { getPoll, listPolls, listResponses, type StoredPoll } from '../../polls/store.ts';
import { MAX_IMAGE_SIZE, PUBLISH_PERMISSIONS, closeAndRedraw, publishPoll } from '../../polls/service.ts';
import { memberNames } from '../../lib/members.ts';

const MAX_FILE_SIZE = 200 * 1024;
const EXAMPLE_FILE = new URL('../../../examples/poll-example.txt', import.meta.url);

export const poll: Command = {
  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Опросы из файла: много страниц, условия, итоги')
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Опубликовать опрос из файла (шаблон — /poll template)')
        .addAttachmentOption((o) => o.setName('file').setDescription('Файл опроса (.txt)').setRequired(true))
        .addAttachmentOption((o) => o.setName('image').setDescription('Картинка под текстом опроса'))
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Куда опубликовать (по умолчанию — сюда)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        )
        .addRoleOption((o) => o.setName('mention').setDescription('Какую роль упомянуть над опросом')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('results')
        .setDescription('Итоги опроса + таблица для Excel')
        .addStringOption((o) => o.setName('poll').setDescription('Какой опрос').setRequired(true).setAutocomplete(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('close')
        .setDescription('Закрыть опрос — новые ответы не принимаются')
        .addStringOption((o) => o.setName('poll').setDescription('Какой опрос').setRequired(true).setAutocomplete(true)),
    )
    .addSubcommand((sub) => sub.setName('template').setDescription('Получить пример файла опроса с подсказками'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'create') await create(interaction);
    else if (sub === 'results') await results(interaction);
    else if (sub === 'close') await close(interaction);
    else if (sub === 'template') await template(interaction);
  },

  async autocomplete(interaction) {
    const typed = interaction.options.getFocused().toLowerCase();
    const choices = listPolls(interaction.guild.id)
      .map((p) => ({ name: `#${p.id} · ${p.definition.title}${p.closed ? ' (закрыт)' : ''}`.slice(0, 100), value: String(p.id) }))
      .filter((choice) => choice.name.toLowerCase().includes(typed));
    await interaction.respond(choices.slice(0, 25));
  },
};

async function create(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const file = interaction.options.getAttachment('file', true);
  const image = interaction.options.getAttachment('image');
  const role = interaction.options.getRole('mention');

  if (file.size > MAX_FILE_SIZE) return replyEphemeral(interaction, 'Файл опроса слишком большой (больше 200 КБ).');
  if (image && (!image.contentType?.startsWith('image/') || image.size > MAX_IMAGE_SIZE)) {
    return replyEphemeral(interaction, 'Картинка должна быть изображением до 8 МБ.');
  }

  const channel = (interaction.options.getChannel('channel') as GuildTextBasedChannel | null) ?? interaction.channel;
  if (!channel) return replyEphemeral(interaction, 'Не вижу канал для публикации.');
  const me = interaction.guild.members.me ?? (await interaction.guild.members.fetchMe());
  if (!channel.permissionsFor(me).has(PUBLISH_PERMISSIONS)) {
    return replyEphemeral(interaction, `В ${channel} мне нужны права: видеть канал, отправлять сообщения и прикреплять файлы.`);
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const source = (await download(file.url)).toString('utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const parsed = parsePollFile(source);
  if (!parsed.ok) {
    const list = parsed.errors.slice(0, 15).map((e) => `• ${e}`);
    if (parsed.errors.length > 15) list.push(`…и ещё ${parsed.errors.length - 15}`);
    await interaction.editReply(`❌ В файле опроса есть ошибки:\n${list.join('\n')}`.slice(0, 2000));
    return;
  }

  const { poll: stored, url } = await publishPoll(channel, parsed.poll, interaction.user.id, {
    ...(image ? { image: { data: await download(image.url), fileName: image.name } } : {}),
    ...(role ? { mentionRoleId: role.id } : {}),
    source,
  });
  await interaction.editReply(`✅ Опрос #${stored.id} опубликован: ${url}\nИтоги — \`/poll results\`, закрыть — \`/poll close\`.`);
}

async function results(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const target = findPoll(interaction);
  if (!target) return replyEphemeral(interaction, 'Такой опрос не найден.');

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const responses = listResponses(target.id);
  const names = target.definition.anonymous ? new Map<string, string>() : await memberNames(interaction.guild, responses.map((r) => r.userId));

  const embed = new EmbedBuilder()
    .setColor(Colors.Gold)
    .setTitle(`📊 ${target.definition.title}`.slice(0, 256))
    .setDescription(buildResultsText(target, responses))
    .setFooter({ text: `Опрос #${target.id}${target.closed ? ' · закрыт' : ''}${target.definition.anonymous ? ' · анонимный' : ''}` });
  const csv = new AttachmentBuilder(Buffer.from(buildResultsCsv(target, responses, names), 'utf8'), { name: `poll-${target.id}.csv` });

  await interaction.editReply({ embeds: [embed], files: [csv] });
}

async function close(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const target = findPoll(interaction);
  if (!target) return replyEphemeral(interaction, 'Такой опрос не найден.');
  if (target.closed) return replyEphemeral(interaction, 'Этот опрос уже закрыт.');

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await closeAndRedraw(interaction.guild, target);
  await interaction.editReply(`🔒 Опрос #${target.id} закрыт. Итоги — \`/poll results\`.`);
}

async function template(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const file = new AttachmentBuilder(await readFile(EXAMPLE_FILE), { name: 'poll-example.txt' });
  await interaction.reply({
    content:
      '📄 Пример файла опроса. Скачай, отредактируй (подсказки — в начале файла), сохрани в кодировке UTF-8 ' +
      'и загрузи через `/poll create file:`.',
    files: [file],
    flags: MessageFlags.Ephemeral,
  });
}

function findPoll(interaction: ChatInputCommandInteraction<'cached'>): StoredPoll | null {
  const found = getPoll(Number(interaction.options.getString('poll', true)));
  return found && found.guildId === interaction.guild.id ? found : null;
}
