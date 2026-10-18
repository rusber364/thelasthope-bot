// Приветствие в личку (как в Carl-bot): памятка новичку и кнопки-ссылки на нужные каналы.
// Это дополнение к приветствию в канале — то остаётся как было. Анкета новичков (если включена «и в личку»)
// приходит кнопкой в том же сообщении, а при выключенном приветствии в личку — коротким сообщением сама по себе.
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RESTJSONErrorCodes,
  type GuildMember,
  type MessageCreateOptions,
} from 'discord.js';
import { getSettings } from '../botSettings.ts';
import { getPoll, type StoredPoll } from '../polls/store.ts';

export interface WelcomeDmData {
  userId: string;
  name: string;
  server: string;
  /** ID каналов; null — канал не выбран, вместо ссылки подставится слово. */
  rules: string | null;
  welcome: string | null;
  role: string;
}

/** Подстановки в текст: {user} {name} {server} {rules} {welcome} {role}. */
export function fillWelcomeDm(text: string, data: WelcomeDmData): string {
  const channel = (id: string | null, fallback: string) => (id ? `<#${id}>` : fallback);
  return text
    .replaceAll('{user}', `<@${data.userId}>`)
    .replaceAll('{name}', data.name)
    .replaceAll('{server}', data.server)
    .replaceAll('{rules}', channel(data.rules, 'правила'))
    .replaceAll('{auth}', 'авторизацию') // канала авторизации больше нет — для старых своих текстов
    .replaceAll('{welcome}', channel(data.welcome, 'канале приветствий'))
    .replaceAll('{role}', data.role);
}

/** Анкета новичков для лички: открытый опрос этого сервера, и в админке включено «и в личку». */
function dmSurvey(member: GuildMember): StoredPoll | null {
  const { onboarding } = getSettings();
  if (!onboarding.dm || onboarding.pollId === null) return null;
  const poll = getPoll(onboarding.pollId);
  return poll && !poll.closed && poll.guildId === member.guild.id ? poll : null;
}

type WelcomeDm = Pick<MessageCreateOptions, 'content' | 'components' | 'allowedMentions'>;

/** Сообщение в личку. withWelcome — с текстом приветствия (иначе только анкета). null — отправлять нечего. */
export function buildWelcomeDm(member: GuildMember, withWelcome = true): WelcomeDm | null {
  const { guild } = member;
  const { channels, roles, welcome, welcomeDm, onboarding } = getSettings();
  const guestRole = roles.guest ? guild.roles.cache.get(roles.guest) : undefined;
  const data: WelcomeDmData = {
    userId: member.id,
    name: member.displayName,
    server: guild.name,
    rules: channels.rules,
    welcome: channels.welcome,
    role: guestRole?.name ?? 'Гость',
  };
  const survey = dmSurvey(member);
  if (!withWelcome && !survey) return null;

  const parts = [withWelcome ? fillWelcomeDm(welcomeDm.text, data) : `Привет, ${member.displayName}! 👋 Добро пожаловать в **${guild.name}**.`];
  if (survey) parts.push(`📝 ${fillWelcomeDm(onboarding.offer, data)}`);
  const content = parts.join('\n\n');

  // Кнопки-ссылки открывают канал на сервере прямо из лички.
  const link = (channelId: string, emoji: string, label: string) =>
    new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${guild.id}/${channelId}`).setEmoji(emoji).setLabel(label);
  const buttons: ButtonBuilder[] = [];
  // Кнопка анкеты — та же, что в приветствии на сервере: опрос проходят прямо в личке.
  if (survey) buttons.push(new ButtonBuilder().setCustomId(`poll:start:${survey.id}`).setStyle(ButtonStyle.Primary).setEmoji('📝').setLabel(onboarding.button));
  if (channels.rules) buttons.push(link(channels.rules, '📖', welcome.rulesButton));

  return {
    content,
    components: buttons.length ? [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)] : [],
    allowedMentions: { parse: [] },
  };
}

/** sent — доставлено; off — слать нечего (приветствие в личку выключено, анкеты в личку нет); closed — у человека закрыта личка; failed — другая ошибка. */
export type WelcomeDmResult = 'sent' | 'off' | 'closed' | 'failed';

/** Написать новичку в личку. force — отправить, даже если выключено (пробная отправка из админки). */
export async function sendWelcomeDm(member: GuildMember, force = false): Promise<WelcomeDmResult> {
  const message = buildWelcomeDm(member, force || getSettings().welcomeDm.enabled);
  if (!message) return 'off';
  try {
    await member.send(message);
    return 'sent';
  } catch (error) {
    // Личка закрыта настройками приватности — обычное дело, не ошибка бота.
    if ((error as { code?: unknown } | null)?.code === RESTJSONErrorCodes.CannotSendMessagesToThisUser) return 'closed';
    console.error('Не удалось отправить приветствие в личку:', error);
    return 'failed';
  }
}
