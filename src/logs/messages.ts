// «лог-сообщения»: удалённые, изменённые и массово удалённые сообщения.
// Если сообщение было отправлено до запуска бота, Discord не присылает его текст — пишем «текст неизвестен».
import { EmbedBuilder, Events, type Client, type Message, type PartialMessage } from 'discord.js';
import { LOG_COLORS, isLogChannel, sendLog } from './send.ts';

const TEXT_LIMIT = 1000;

/** ID сообщений, которые бот удалил сам (фильтр мата, автоочистка) — их удаление он записывает сам. */
const deletedByBot = new Set<string>();

export function markDeletedByBot(messageId: string): void {
  deletedByBot.add(messageId);
  setTimeout(() => deletedByBot.delete(messageId), 60_000);
}

function quote(text: string | null | undefined): string {
  if (text == null) return '*текст неизвестен — сообщение было отправлено до запуска бота*';
  if (!text.trim()) return '*без текста*';
  const cut = text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}…` : text;
  return cut.replaceAll('```', "'''");
}

function attachmentsOf(message: Message | PartialMessage): string | null {
  if (message.partial || !message.attachments.size) return null;
  return message.attachments.map((a) => `[${a.name}](${a.url})`).join('\n').slice(0, 1024);
}

export function registerMessageLogs(client: Client): void {
  client.on(Events.MessageDelete, async (message) => {
    if (!message.guild || isLogChannel(message.channelId)) return;
    if (deletedByBot.delete(message.id)) return;
    if (!message.partial && (message.author.bot || message.system)) return;

    const embed = new EmbedBuilder()
      .setColor(LOG_COLORS.delete)
      .setTitle('Сообщение удалено')
      .addFields({ name: 'Канал', value: `<#${message.channelId}>`, inline: true })
      .setFooter({ text: `ID сообщения: ${message.id}` });
    if (!message.partial) embed.addFields({ name: 'Автор', value: `${message.author} · ${message.author.tag}`, inline: true });
    embed.addFields({ name: 'Текст', value: quote(message.partial ? null : message.content) });
    const files = attachmentsOf(message);
    if (files) embed.addFields({ name: 'Вложения', value: files });

    await sendLog(message.guild, 'messages', embed);
  });

  client.on(Events.MessageUpdate, async (before, after) => {
    if (!after.guild || isLogChannel(after.channelId)) return;
    const message = after.partial ? await after.fetch().catch(() => null) : after;
    if (!message || message.author.bot || message.system) return;
    // Discord присылает «изменение», когда подгружает превью ссылки, — текст при этом тот же.
    if (!before.partial && before.content === message.content) return;

    const embed = new EmbedBuilder()
      .setColor(LOG_COLORS.update)
      .setTitle('Сообщение изменено')
      .setDescription(`[Перейти к сообщению](${message.url})`)
      .addFields(
        { name: 'Канал', value: `<#${message.channelId}>`, inline: true },
        { name: 'Автор', value: `${message.author} · ${message.author.tag}`, inline: true },
        { name: 'Было', value: quote(before.partial ? null : before.content) },
        { name: 'Стало', value: quote(message.content) },
      )
      .setFooter({ text: `ID сообщения: ${message.id}` });

    await sendLog(after.guild, 'messages', embed);
  });

  client.on(Events.MessageBulkDelete, async (messages, channel) => {
    if (isLogChannel(channel.id)) return;
    // Пачку удалил сам бот (автоочистка) — сводку он запишет сам.
    if (messages.every((m) => deletedByBot.has(m.id))) {
      messages.forEach((m) => deletedByBot.delete(m.id));
      return;
    }
    const authors = new Set(messages.filter((m) => !m.partial).map((m) => (m.partial ? '' : m.author.tag)));
    const embed = new EmbedBuilder()
      .setColor(LOG_COLORS.delete)
      .setTitle('Массовое удаление сообщений')
      .addFields(
        { name: 'Канал', value: `${channel}`, inline: true },
        { name: 'Удалено', value: `${messages.size}`, inline: true },
      );
    if (authors.size) embed.addFields({ name: 'Авторы', value: [...authors].slice(0, 20).join(', ').slice(0, 1024) });
    await sendLog(channel.guild, 'messages', embed);
  });
}
