import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import {
  AttachmentBuilder,
  ChannelType,
  Colors,
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type Attachment,
  type ChatInputCommandInteraction,
  type GuildTextBasedChannel,
} from 'discord.js';
import type { Command } from '../../types.ts';
import { replyEphemeral } from '../../lib/reply.ts';
import { parsePollFile } from '../../polls/format.ts';
import { buildPublicMessage, buildResultsCsv, buildResultsText } from '../../polls/render.ts';
import { closePoll, createPoll, deletePoll, getPoll, listPolls, listResponses, setPollMessage, type StoredPoll } from '../../polls/store.ts';

const MAX_FILE_SIZE = 200 * 1024;
const MAX_IMAGE_SIZE = 8 * 1024 * 1024;
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
  const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles];
  if (!channel.permissionsFor(me).has(needed)) {
    return replyEphemeral(interaction, `В ${channel} мне нужны права: видеть канал, отправлять сообщения и прикреплять файлы.`);
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const parsed = parsePollFile(await download(file).then((data) => data.toString('utf8')));
  if (!parsed.ok) {
    const list = parsed.errors.slice(0, 15).map((e) => `• ${e}`);
    if (parsed.errors.length > 15) list.push(`…и ещё ${parsed.errors.length - 15}`);
    await interaction.editReply(`❌ В файле опроса есть ошибки:\n${list.join('\n')}`.slice(0, 2000));
    return;
  }

  const definition = parsed.poll;
  const files: AttachmentBuilder[] = [];
  if (image) {
    const name = `poll-image${extname(image.name) || '.png'}`;
    files.push(new AttachmentBuilder(await download(image), { name }));
    definition.image = `attachment://${name}`;
  }
  if (role) definition.mentionRoleId = role.id;

  const stored = createPoll(interaction.guild.id, channel.id, definition, interaction.user.id);
  try {
    const message = await channel.send({ ...buildPublicMessage(stored), files, flags: MessageFlags.IsComponentsV2 });
    setPollMessage(stored.id, message.id);
    await interaction.editReply(`✅ Опрос #${stored.id} опубликован: ${message.url}\nИтоги — \`/poll results\`, закрыть — \`/poll close\`.`);
  } catch (error) {
    deletePoll(stored.id);
    throw error;
  }
}

async function results(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const target = findPoll(interaction);
  if (!target) return replyEphemeral(interaction, 'Такой опрос не найден.');

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const responses = listResponses(target.id);
  const names = target.definition.anonymous ? new Map<string, string>() : await memberNames(interaction, responses.map((r) => r.userId));

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
  closePoll(target.id);
  await redrawClosed(interaction, { ...target, closed: true });
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

async function download(attachment: Pick<Attachment, 'url'>): Promise<Buffer> {
  const response = await fetch(attachment.url);
  if (!response.ok) throw new Error(`Не удалось скачать вложение: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/** Перерисовывает сообщение опроса как закрытое. Прикреплённую картинку загружаем заново, чтобы она не пропала. */
async function redrawClosed(interaction: ChatInputCommandInteraction<'cached'>, target: StoredPoll): Promise<void> {
  if (!target.messageId) return;
  try {
    const channel = await interaction.client.channels.fetch(target.channelId);
    if (!channel?.isTextBased()) return;
    const message = await channel.messages.fetch(target.messageId);
    const files: AttachmentBuilder[] = [];
    for (const attachment of message.attachments.values()) {
      files.push(new AttachmentBuilder(await download(attachment), { name: attachment.name }));
    }
    await message.edit({ ...buildPublicMessage(target), files, attachments: [] });
  } catch (error) {
    console.error(`Не удалось обновить сообщение опроса #${target.id}:`, error);
  }
}

async function memberNames(interaction: ChatInputCommandInteraction<'cached'>, userIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (let i = 0; i < userIds.length; i += 100) {
    const chunk = userIds.slice(i, i + 100);
    const members = await interaction.guild.members.fetch({ user: chunk }).catch(() => null);
    members?.forEach((member) => names.set(member.id, `${member.displayName} (@${member.user.username})`));
  }
  return names;
}
