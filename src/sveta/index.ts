// Света — ИИ-персонаж в выбранных каналах. Это отдельный бот-аккаунт (свой токен SVETA_TOKEN, своё имя и аватарка)
// с урезанными правами: видеть, читать историю, писать и ставить реакции — только в её каналах. Работает внутри
// нашего бота вторым подключением к Discord; отвечает моделью Google Gemini (GEMINI_API_KEY).
import {
  Client,
  Events,
  GatewayIntentBits,
  OAuth2Scopes,
  PermissionFlagsBits,
  PermissionsBitField,
  type Message,
} from 'discord.js';
import { getSettings } from '../botSettings.ts';
import { config } from '../config.ts';
import { settings as constants } from '../settings.ts';
import { HISTORY, buildContents, cleanReply, lineText, type ChatLine } from './context.ts';
import { GeminiError, generate, type GeminiReply } from './gemini.ts';
import { BREAK_LINES, Limiter, countRequests, dayKey, repliesOn, requestsOn } from './limits.ts';
import { systemPrompt } from './persona.ts';
import { FORGOTTEN, MEMORY, MEMORY_TOOLS, MEMORY_TOOL_NAMES, NOTHING_TO_FORGET, dossiers, forgetPerson, getPerson, memoryCommand, memoryReport, runMemoryTool, type Person } from './memory.ts';
import { loreText, matchLore } from './lore.ts';
import { TOOLS, guildSummary, runTool } from './tools.ts';
import { TRIGGER_LABEL, triggerOf } from './triggers.ts';

/** Права Светы: только читать и писать. Банить, кикать, трогать роли и каналы Discord ей не даст. */
export const SVETA_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AddReactions,
];

export function svetaInviteUrl(clientId: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    scope: OAuth2Scopes.Bot,
    permissions: new PermissionsBitField(SVETA_PERMISSIONS).bitfield.toString(),
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

/** Зависимости, которые тесты подменяют. */
export interface SvetaDeps {
  generate: typeof generate;
  now: () => number;
  random: () => number;
  apiKey: () => string | undefined;
}

const DEFAULT_DEPS: SvetaDeps = { generate, now: Date.now, random: Math.random, apiKey: () => config.geminiApiKey };
const HOUR = 60 * 60 * 1000;
/** Сколько раз за ответ модель может попросить инструменты (каждый круг — ещё один запрос к Gemini). */
const MAX_TOOL_ROUNDS = 2;

let client: Client | null = null;
let limiter = new Limiter();
let lastError: { at: number; text: string } | null = null;

/** Сбросить состояние (для тестов). */
export function resetSveta(): void {
  limiter = new Limiter();
  lastError = null;
}

/** Ошибку пишем в «Лог бота» не чаще раза в час на каждый вид — и показываем в админке. */
function noteError(text: string, now: number): void {
  if (lastError?.text !== text || now - lastError.at > HOUR) console.error(`🤖 Света: ${text}`);
  lastError = { at: now, text };
}

const ERROR_TEXT = {
  auth: 'Gemini не принял ключ — проверь GEMINI_API_KEY в .env.',
  model: 'Такой модели у Gemini нет — поправь модель на странице «Света».',
  unavailable: 'Gemini не ответил',
} as const;

const formatNow = (now: number) =>
  new Intl.DateTimeFormat('ru-RU', { timeZone: constants.timeZone, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(now);

/** Новое сообщение в канале: решаем, отвечать ли, и отвечаем. */
export async function onMessage(message: Message, deps: SvetaDeps = DEFAULT_DEPS): Promise<void> {
  const s = getSettings().sveta;
  const me = message.client.user?.id;
  if (!s.enabled || !me || !message.inGuild()) return;

  const trigger = triggerOf(
    {
      authorIsBot: message.author.bot,
      channelId: message.channelId,
      content: message.content,
      // Discord в подсказке «@» предлагает и саму Свету, и её роль с тем же именем — считаем обращением оба.
      mentionsSveta: message.mentions.users.has(me) || message.mentions.roles.some((role) => role.tags?.botId === me),
      replyToSveta: message.mentions.repliedUser?.id === me,
    },
    s.channelIds,
    s.randomPercent,
    deps.random(),
  );
  if (!trigger) return;

  const now = deps.now();
  const apiKey = deps.apiKey();
  if (!apiKey) return noteError('нет ключа: впиши GEMINI_API_KEY в .env и перезапусти бота.', now);

  const quiet = { parse: [] as never[], repliedUser: false };
  const authorName = message.member?.displayName ?? message.author.displayName;

  // «Что ты обо мне помнишь» и «забудь меня» — отвечает код: точно, без запроса к Gemini и без лимитов.
  const command = trigger === 'random' ? null : memoryCommand(message.content);
  if (command === 'ask') {
    await message.reply({ content: memoryReport(getPerson(message.guildId, message.author.id)), allowedMentions: quiet });
    return;
  }
  if (command === 'forget') {
    const forgotten = forgetPerson(message.guildId, message.author.id);
    await message.reply({ content: forgotten ? FORGOTTEN : NOTHING_TO_FORGET, allowedMentions: quiet });
    if (forgotten) console.log(`🧹 Света стёрла память по просьбе: ${authorName}.`);
    return;
  }

  const verdict = limiter.check(trigger, message.author.id, message.channelId, now, s);
  if (verdict !== 'ok') {
    // Позвали, а ответить нельзя: один раз в час говорим, что на перерыве; в остальных случаях молчим.
    const breakKind = verdict === 'hour' || verdict === 'day' || verdict === 'paused' ? verdict : null;
    if (trigger !== 'random' && breakKind && limiter.shouldNotice(message.channelId, now)) {
      await message.reply({ content: BREAK_LINES[breakKind], allowedMentions: quiet });
    }
    return;
  }
  limiter.record(message.author.id, message.channelId, now);

  await message.channel.sendTyping().catch(() => {});
  const earlier = await message.channel.messages.fetch({ limit: HISTORY - 1, before: message.id }).catch(() => null);
  const history = [...(earlier?.values() ?? [])].reverse().concat(message);
  const lines: ChatLine[] = history.map((m) => ({
    name: m.member?.displayName ?? m.author.displayName,
    text: lineText(m.cleanContent, m.attachments.size, m.stickers.size),
    fromSveta: m.author.id === me,
  }));
  // Досье тех, кто в разговоре (люди, не боты), — Света видит, как к кому относится.
  const people = [...new Set(history.filter((m) => !m.author.bot).map((m) => m.author.id))]
    .map((userId) => getPerson(message.guildId, userId))
    .filter((person): person is Person => person !== null);

  const system = systemPrompt(s.persona, {
    guildName: message.guild.name,
    now: formatNow(now),
    summary: guildSummary(message.guildId),
    people: dossiers(people),
    // Истории — только о тех, кого назвали в разговоре или кто в нём пишет.
    lore: loreText(matchLore(s.lore, lines.map((line) => `${line.name}: ${line.text}`))),
  });
  const author = { guildId: message.guildId, userId: message.author.id, name: authorName };
  let writes = 0;
  // Инструменты сборов только читают; инструменты памяти пишут — только об авторе и не больше трёх раз за ответ.
  const runCall = (call: { name: string; args: Record<string, unknown> }) => {
    if (!MEMORY_TOOL_NAMES.has(call.name)) return runTool(call.name, call.args, message.guildId);
    if (++writes > MEMORY.writesPerReply) return { error: 'Хватит записей на этот раз.' };
    return runMemoryTool(call.name, call.args, author, now);
  };
  let contents = buildContents(lines);
  const used: string[] = [];
  let requests = 0;
  try {
    // Модель может попросить инструменты (состав реги, расписание): бот выполняет их и спрашивает ещё раз.
    // Не больше MAX_TOOL_ROUNDS кругов, на последнем — только текст.
    let reply: GeminiReply;
    for (let round = 0; ; round++) {
      const last = round >= MAX_TOOL_ROUNDS;
      requests++;
      reply = await deps.generate({ apiKey, model: s.model, system, contents, tools: [...TOOLS, ...MEMORY_TOOLS], toolMode: last ? 'NONE' : 'AUTO' });
      if (!reply.calls.length) break;
      used.push(...reply.calls.map((call) => call.name));
      // Ответ модели возвращаем целиком (с подписями мыслей), а на каждый вызов — ровно один результат с тем же id.
      const results = reply.calls.map((call) => ({
        functionResponse: { name: call.name, ...(call.id ? { id: call.id } : {}), response: { result: runCall(call) } },
      }));
      // Только записи в память, а текст уже есть, — второй запрос не нужен.
      if (last || (reply.calls.every((call) => MEMORY_TOOL_NAMES.has(call.name)) && cleanReply(reply.text))) break;
      contents = [...contents, reply.content, { role: 'user', parts: results }];
    }
    const text = cleanReply(reply.text);
    if (!text) return;
    // Кто позвал — получит уведомление об ответе; если встряла сама — без уведомления.
    await message.reply({ content: text, allowedMentions: { parse: [], repliedUser: trigger !== 'random' } });
    const channel = 'name' in message.channel ? `#${message.channel.name}` : message.channelId;
    const details = [TRIGGER_LABEL[trigger], `запросов: ${requests}`, used.length ? `инструменты: ${[...new Set(used)].join(', ')}` : '', reply.tokens ? `токенов: ${reply.tokens}` : ''];
    console.log(`💬 Света ответила в ${channel} (${details.filter(Boolean).join(', ')}).`);
  } catch (error) {
    if (!(error instanceof GeminiError)) throw error;
    if (error.kind === 'quota') {
      limiter.pause(now);
      noteError('Gemini сказал, что бесплатный лимит исчерпан — молчу час.', now);
      if (trigger !== 'random' && limiter.shouldNotice(message.channelId, now)) await message.reply({ content: BREAK_LINES.paused, allowedMentions: quiet });
    } else if (error.kind === 'blocked') {
      if (trigger !== 'random') await message.reply({ content: 'Не-не, такое я обсуждать не буду 😅', allowedMentions: quiet });
    } else {
      noteError(error.kind === 'unavailable' ? `${ERROR_TEXT.unavailable}: ${error.message}` : ERROR_TEXT[error.kind], now);
      // Google не ответил вовремя — позвавший не должен ждать в тишине.
      if (error.kind === 'unavailable' && trigger !== 'random') {
        await message.reply({ content: 'Что-то я задумалась 🤔 Спроси ещё раз чуть позже.', allowedMentions: quiet });
      }
    }
  } finally {
    if (requests) countRequests(dayKey(now), requests);
  }
}

/** Канал, куда Света может написать (для новостей о сборах). null — Света не подключена или канала не видит. */
export function svetaChannel(channelId: string) {
  const channel = client?.isReady() ? client.channels.cache.get(channelId) : undefined;
  return channel?.isSendable() ? channel : null;
}

/** Подключить Свету к Discord. Без SVETA_TOKEN — ничего не делает: остальной бот работает как обычно. */
export async function startSveta(): Promise<void> {
  if (!config.svetaToken) return;
  const sveta = new Client({
    // ★ Message Content Intent нужно включить и у приложения Светы: Developer Portal → Bot.
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  });
  sveta.once(Events.ClientReady, (ready) => {
    console.log(`🤖 Света подключена как ${ready.user.tag}.`);
    console.log(`🔗 Пригласить Свету на сервер: ${svetaInviteUrl(ready.application.id)}`);
  });
  sveta.on(Events.MessageCreate, (message) => void onMessage(message).catch((error) => console.error('🤖 Света: ошибка при ответе:', error)));
  sveta.on(Events.Error, (error) => console.error('🤖 Света: ошибка клиента Discord:', error));
  try {
    await sveta.login(config.svetaToken);
    client = sveta;
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (/disallowed intents/i.test(text)) console.error('❌ Света: включи Message Content Intent у её приложения в Developer Portal → Bot.');
    else if (/invalid token/i.test(text)) console.error('❌ Света: неверный SVETA_TOKEN — сбрось токен в Developer Portal → Bot и обнови .env.');
    else console.error('❌ Света: не удалось подключиться к Discord:', error);
    await sveta.destroy().catch(() => {});
  }
}

export interface SvetaStatus {
  hasToken: boolean;
  hasKey: boolean;
  connected: boolean;
  tag: string | null;
  inviteUrl: string | null;
  /** Света добавлена на сервер админки. */
  onServer: boolean;
  /** Каналы из списка (и канал новостей), где у Светы нет прав видеть, читать историю или писать. */
  channelsWithoutAccess: string[];
  today: number;
  /** Запросов к Gemini сегодня — именно их считает бесплатный лимит Google. */
  requestsToday: number;
  lastError: { at: number; text: string } | null;
}

/** Состояние для страницы «Света» в админке. */
export function svetaStatus(guildId: string): SvetaStatus {
  const s = getSettings().sveta;
  const ready = client?.isReady() ? client : null;
  const guild = ready?.guilds.cache.get(guildId);
  const me = guild?.members.me;
  const channelsWithoutAccess = guild
    ? [...new Set([...s.channelIds, ...(s.newsChannelId ? [s.newsChannelId] : [])])].filter((id) => {
        const channel = guild.channels.cache.get(id);
        return !channel || !me || !channel.permissionsFor(me).has(SVETA_PERMISSIONS.slice(0, 3));
      })
    : [];
  return {
    hasToken: Boolean(config.svetaToken),
    hasKey: Boolean(config.geminiApiKey),
    connected: Boolean(ready),
    tag: ready?.user.tag ?? null,
    inviteUrl: ready ? svetaInviteUrl(ready.application.id) : null,
    onServer: Boolean(guild),
    channelsWithoutAccess,
    today: repliesOn(dayKey(Date.now())),
    requestsToday: requestsOn(dayKey(Date.now())),
    lastError,
  };
}
