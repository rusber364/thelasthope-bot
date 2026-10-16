// Разбор инцидентов (как Drama Watcher в Carl-bot Premium): подозрительное публикуется в канал модераторов
// карточкой с кнопками «Мут 1 ч», «Бан», «Пропустить» — не нужно искать нарушителя по логам.
// Источники: удаление мата фильтром, вход совсем нового аккаунта, массовые упоминания.
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Colors,
  EmbedBuilder,
  Events,
  MessageFlags,
  PermissionFlagsBits,
  TimestampStyles,
  time,
  type Client,
  type Guild,
  type GuildMember,
  type Message,
  type User,
} from 'discord.js';
import { getSettings } from '../botSettings.ts';
import { logModAction } from '../lib/modlog.ts';
import { replyEphemeral } from '../lib/reply.ts';
import type { ComponentHandler, ComponentInteraction } from '../types.ts';

const DAY = 24 * 60 * 60 * 1000;
/** Аккаунт моложе стольких дней при входе на сервер — повод присмотреться (часто твинки и спамеры). */
export const NEW_ACCOUNT_DAYS = 3;
/** Столько разных людей и ролей в одном сообщении — массовые упоминания. */
export const MASS_MENTIONS = 5;
const MUTE_MS = 60 * 60 * 1000;

export type IncidentKind = 'profanity' | 'newAccount' | 'massMentions';

const TITLES: Record<IncidentKind, string> = {
  profanity: '🤬 Мат в чате',
  newAccount: '🆕 Вход совсем нового аккаунта',
  massMentions: '📣 Массовые упоминания',
};

export interface Incident {
  kind: IncidentKind;
  user: Pick<User, 'id' | 'tag' | 'createdTimestamp'>;
  channelId?: string;
  details: string;
}

/** Карточка инцидента (чистая функция). */
export function buildIncident(incident: Incident) {
  const embed = new EmbedBuilder()
    .setColor(Colors.Orange)
    .setTitle(TITLES[incident.kind])
    .addFields(
      { name: 'Участник', value: `<@${incident.user.id}> · ${incident.user.tag}\nID: ${incident.user.id}`, inline: true },
      { name: 'Аккаунт создан', value: time(new Date(incident.user.createdTimestamp), TimestampStyles.RelativeTime), inline: true },
    )
    .setTimestamp();
  if (incident.channelId) embed.addFields({ name: 'Канал', value: `<#${incident.channelId}>`, inline: true });
  embed.addFields({ name: 'Что случилось', value: incident.details.slice(0, 1024) });

  const id = incident.user.id;
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`incident:mute:${id}`).setLabel('Мут 1 ч').setEmoji('🔇').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`incident:ban:${id}`).setLabel('Бан').setEmoji('⛔').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`incident:skip:${id}`).setLabel('Пропустить').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [buttons], allowedMentions: { parse: [] as [] } };
}

/** Опубликовать инцидент в канал модераторов (если он выбран в админке). */
export async function reportIncident(guild: Guild, incident: Incident): Promise<void> {
  const channelId = getSettings().alerts.incidentChannelId;
  if (!channelId) return;
  const channel = guild.channels.cache.get(channelId);
  if (!channel?.isSendable()) return;
  await channel.send(buildIncident(incident)).catch((error) => console.error('Не удалось отправить инцидент:', error));
}

// --- Подозрительные события ---

export function isNewAccount(createdTimestamp: number, now = Date.now()): boolean {
  return now - createdTimestamp < NEW_ACCOUNT_DAYS * DAY;
}

/** Сколько разных людей и ролей упомянуто; tryEveryone — попытка @everyone/@here без права. */
export function mentionStats(message: Pick<Message, 'content' | 'mentions'>, canMentionEveryone: boolean): { count: number; tryEveryone: boolean } {
  const count = message.mentions.users.size + message.mentions.roles.size;
  const tryEveryone = !canMentionEveryone && /@(everyone|here)\b/.test(message.content);
  return { count, tryEveryone };
}

export function registerIncidents(client: Client): void {
  client.on(Events.GuildMemberAdd, async (member) => {
    if (member.user.bot || !isNewAccount(member.user.createdTimestamp)) return;
    await reportIncident(member.guild, {
      kind: 'newAccount',
      user: member.user,
      details: `Аккаунту меньше ${NEW_ACCOUNT_DAYS} дней. Часто это твинки и спамеры — присмотрись, что он будет писать.`,
    });
  });

  client.on(Events.MessageCreate, async (message) => {
    if (!message.inGuild() || message.author.bot || message.system) return;
    const canMentionEveryone = message.member?.permissions.has(PermissionFlagsBits.MentionEveryone) ?? false;
    const { count, tryEveryone } = mentionStats(message, canMentionEveryone);
    if (count < MASS_MENTIONS && !tryEveryone) return;
    await reportIncident(message.guild, {
      kind: 'massMentions',
      user: message.author,
      channelId: message.channelId,
      details: `${tryEveryone ? 'Попытка упомянуть @everyone/@here без права. ' : ''}Упомянуто людей и ролей: ${count}. [Сообщение](${message.url})\n>>> ${message.content.slice(0, 600)}`,
    });
  });
}

// --- Кнопки на карточке ---

/** Можно ли нажавшему наказывать этого участника: права и иерархия ролей. Текст проблемы или null. */
export function actionProblem(moderator: GuildMember, target: GuildMember | null, permission: bigint, guildOwnerId: string): string | null {
  if (!moderator.permissions.has(permission)) {
    return permission === PermissionFlagsBits.BanMembers ? 'Нужно право «Банить участников».' : 'Нужно право «Модерировать участников».';
  }
  if (!target) return null; // участник уже ушёл — забанить его всё равно можно
  if (target.id === moderator.id) return 'Себя наказывать не нужно 🙂';
  if (target.id === guildOwnerId) return 'Владельца сервера наказать нельзя.';
  if (moderator.id !== guildOwnerId && target.roles.highest.comparePositionTo(moderator.roles.highest) >= 0) {
    return 'Роль этого участника не ниже твоей.';
  }
  return null;
}

/** Отметить решение на карточке и убрать кнопки. */
function decided(interaction: ComponentInteraction, text: string) {
  const embed = EmbedBuilder.from(interaction.message!.embeds[0]!).setColor(Colors.Grey).addFields({ name: 'Решение', value: text });
  return { embeds: [embed], components: [] };
}

export const incidentHandler: ComponentHandler = {
  prefix: 'incident',
  async handle(interaction, [action, userId, cardId]) {
    if (!interaction.isButton() || !userId) return;
    const { guild, member: moderator } = interaction;
    const target = await guild.members.fetch(userId).catch(() => null);
    const card = `[карточка инцидента](${interaction.message.url})`;

    if (action === 'skip') {
      const problem = actionProblem(moderator, null, PermissionFlagsBits.ModerateMembers, guild.ownerId);
      if (problem) return replyEphemeral(interaction, problem);
      await interaction.update(decided(interaction, `✅ Пропущено — ${moderator}`));
      await logModAction(guild, { title: '✅ Инцидент пропущен', color: Colors.Grey, moderator: interaction.user, ...(target ? { target: target.user } : {}), details: card });
      return;
    }

    if (action === 'mute') {
      const problem = actionProblem(moderator, target, PermissionFlagsBits.ModerateMembers, guild.ownerId);
      if (problem) return replyEphemeral(interaction, problem);
      if (!target) return replyEphemeral(interaction, 'Участник уже ушёл с сервера — замутить нельзя, можно забанить.');
      if (!target.moderatable) return replyEphemeral(interaction, 'Не могу замутить: моя роль должна быть выше роли участника.');
      await target.timeout(MUTE_MS, `Инцидент, решение ${interaction.user.tag}`);
      await interaction.update(decided(interaction, `🔇 Мут на 1 ч — ${moderator}`));
      await logModAction(guild, { title: '🔇 Мут по инциденту', color: Colors.Orange, moderator: interaction.user, target: target.user, details: `На 1 ч. ${card}` });
      return;
    }

    if (action === 'ban') {
      // Бан не отменить одним нажатием — сначала подтверждение (видит только нажавший).
      const problem = actionProblem(moderator, target, PermissionFlagsBits.BanMembers, guild.ownerId);
      if (problem) return replyEphemeral(interaction, problem);
      await interaction.reply({
        content: `Точно забанить <@${userId}>? Сообщения за последние сутки тоже удалятся.`,
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`incident:banok:${userId}:${interaction.message.id}`).setLabel('Да, забанить').setStyle(ButtonStyle.Danger),
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (action === 'banok') {
      const problem = actionProblem(moderator, target, PermissionFlagsBits.BanMembers, guild.ownerId);
      if (problem) return replyEphemeral(interaction, problem);
      if (target && !target.bannable) return replyEphemeral(interaction, 'Не могу забанить: моя роль должна быть выше роли участника.');
      await guild.members.ban(userId, { deleteMessageSeconds: 24 * 60 * 60, reason: `Инцидент, решение ${interaction.user.tag}` });
      await interaction.update({ content: `⛔ <@${userId}> забанен.`, components: [] });
      // Отмечаем решение и на самой карточке инцидента.
      const message = cardId && interaction.channel ? await interaction.channel.messages.fetch(cardId).catch(() => null) : null;
      if (message?.embeds[0]) {
        await message.edit({ embeds: [EmbedBuilder.from(message.embeds[0]).setColor(Colors.Grey).addFields({ name: 'Решение', value: `⛔ Бан — ${moderator}` })], components: [] });
      }
      const banned = target?.user ?? (await interaction.client.users.fetch(userId).catch(() => null));
      await logModAction(guild, { title: '⛔ Бан по инциденту', color: Colors.Red, moderator: interaction.user, ...(banned ? { target: banned } : {}), details: message ? `[карточка инцидента](${message.url})` : undefined });
    }
  },
};
