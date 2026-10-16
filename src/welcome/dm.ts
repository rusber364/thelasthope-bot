// Приветствие в личку (как в Carl-bot): памятка новичку и кнопки-ссылки на нужные каналы.
// Это дополнение к приветствию в канале — то остаётся как было.
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RESTJSONErrorCodes,
  type GuildMember,
  type MessageCreateOptions,
} from 'discord.js';
import { getSettings } from '../botSettings.ts';

export interface WelcomeDmData {
  userId: string;
  name: string;
  server: string;
  /** ID каналов; null — канал не выбран, вместо ссылки подставится слово. */
  rules: string | null;
  auth: string | null;
  welcome: string | null;
  role: string;
}

/** Подстановки в текст: {user} {name} {server} {rules} {auth} {welcome} {role}. */
export function fillWelcomeDm(text: string, data: WelcomeDmData): string {
  const channel = (id: string | null, fallback: string) => (id ? `<#${id}>` : fallback);
  return text
    .replaceAll('{user}', `<@${data.userId}>`)
    .replaceAll('{name}', data.name)
    .replaceAll('{server}', data.server)
    .replaceAll('{rules}', channel(data.rules, 'правила'))
    .replaceAll('{auth}', channel(data.auth, 'авторизацию'))
    .replaceAll('{welcome}', channel(data.welcome, 'канале приветствий'))
    .replaceAll('{role}', data.role);
}

export function buildWelcomeDm(member: GuildMember): Pick<MessageCreateOptions, 'content' | 'components' | 'allowedMentions'> {
  const { guild } = member;
  const { channels, roles, welcome, welcomeDm } = getSettings();
  const guestRole = roles.guest ? guild.roles.cache.get(roles.guest) : undefined;
  const content = fillWelcomeDm(welcomeDm.text, {
    userId: member.id,
    name: member.displayName,
    server: guild.name,
    rules: channels.rules,
    auth: channels.auth,
    welcome: channels.welcome,
    role: guestRole?.name ?? 'Гость',
  });

  // Кнопки-ссылки открывают канал на сервере прямо из лички.
  const link = (channelId: string, emoji: string, label: string) =>
    new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${guild.id}/${channelId}`).setEmoji(emoji).setLabel(label);
  const buttons: ButtonBuilder[] = [];
  if (channels.rules) buttons.push(link(channels.rules, '📖', welcome.rulesButton));
  if (channels.auth) buttons.push(link(channels.auth, '🔓', 'Авторизация'));

  return {
    content,
    components: buttons.length ? [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)] : [],
    allowedMentions: { parse: [] },
  };
}

/** sent — доставлено; off — выключено в админке; closed — у человека закрыта личка; failed — другая ошибка. */
export type WelcomeDmResult = 'sent' | 'off' | 'closed' | 'failed';

/** Написать новичку в личку. force — отправить, даже если выключено (пробная отправка из админки). */
export async function sendWelcomeDm(member: GuildMember, force = false): Promise<WelcomeDmResult> {
  if (!force && !getSettings().welcomeDm.enabled) return 'off';
  try {
    await member.send(buildWelcomeDm(member));
    return 'sent';
  } catch (error) {
    // Личка закрыта настройками приватности — обычное дело, не ошибка бота.
    if ((error as { code?: unknown } | null)?.code === RESTJSONErrorCodes.CannotSendMessagesToThisUser) return 'closed';
    console.error('Не удалось отправить приветствие в личку:', error);
    return 'failed';
  }
}
