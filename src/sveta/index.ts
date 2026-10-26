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
  type MessageReplyOptions,
} from 'discord.js';
import { getSettings } from '../botSettings.ts';
import { config } from '../config.ts';
import { settings as constants } from '../settings.ts';
import { HISTORY, buildContents, cleanReply, lineText, type ChatLine } from './context.ts';
import { GeminiError, ModelRest, generate, generateSteady, readyModels, type GeminiErrorKind, type GeminiReply } from './gemini.ts';
import { generateOpenRouter, isOpenRouterModel } from './openrouter.ts';
import { BREAK_LINES, Limiter, NO_SPEND, addSpend, countRequests, countSpend, dayKey, repliesOn, requestsOn, spendSince, type Spend } from './limits.ts';
import { systemPrompt } from './persona.ts';
import { FORGOTTEN, MEMORY, MEMORY_TOOLS, MEMORY_TOOL_NAMES, NOTHING_TO_FORGET, dossiers, forgetPerson, getPerson, memoryCommand, memoryReport, runMemoryTool, type Person } from './memory.ts';
import { loreText, matchLore } from './lore.ts';
import { TOOLS, guildSummary, runTool } from './tools.ts';
import { TRIGGER_LABEL, triggerOf } from './triggers.ts';
import { ScoldTimer, scoldLine, swearsWithPermission } from './swearing.ts';

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
  /** Ключ Gemini (модели без «/»). */
  apiKey: () => string | undefined;
  /** Ключ OpenRouter (модели с «/», например minimax/minimax-m3.1-flash:free). */
  openrouterKey: () => string | undefined;
  wait: (ms: number) => Promise<void>;
}

const DEFAULT_DEPS: SvetaDeps = {
  // Модель с «/» в имени — через OpenRouter, без — через Gemini.
  generate: (request) => (isOpenRouterModel(request.model) ? generateOpenRouter(request) : generate(request)),
  now: Date.now,
  random: Math.random,
  apiKey: () => config.geminiApiKey,
  openrouterKey: () => config.openrouterApiKey,
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Какой ключ нужен модели и как он называется в .env. */
const keyName = (model: string) => (isOpenRouterModel(model) ? 'OPENROUTER_API_KEY' : 'GEMINI_API_KEY');
const HOUR = 60 * 60 * 1000;
/** Сколько раз за ответ модель может попросить инструменты (каждый круг — ещё один запрос к Gemini). */
const MAX_TOOL_ROUNDS = 2;

let client: Client | null = null;
let limiter = new Limiter();
let rest = new ModelRest();
let scolds = new ScoldTimer();
let lastError: { at: number; text: string } | null = null;

/** Сбросить состояние (для тестов). */
export function resetSveta(): void {
  limiter = new Limiter();
  rest = new ModelRest();
  scolds = new ScoldTimer();
  lastError = null;
}

/** Может ли Света ответить в этом канале: ворчит она и вне своих каналов, а права там могут быть не у неё. */
function canReply(message: Message<true>): boolean {
  const me = message.guild.members.me;
  const send = message.channel.isThread() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages;
  return Boolean(me && message.channel.permissionsFor(me)?.has([send, PermissionFlagsBits.ReadMessageHistory]));
}

/** Ошибку пишем в «Лог бота» не чаще раза в час на каждый вид — и показываем в админке. */
function noteError(text: string, now: number): void {
  if (lastError?.text !== text || now - lastError.at > HOUR) console.error(`🤖 Света: ${text}`);
  lastError = { at: now, text };
}

const ERROR_TEXT = {
  auth: 'Gemini не принял ключ — проверь GEMINI_API_KEY в .env.',
  model: 'Такой модели у Gemini нет — поправь модель на странице «Света».',
  busy: 'Gemini перегружен',
  unavailable: 'Gemini не ответил',
} as const;

/** Почему модель не ответила — для строки в «Логе бота». */
const FAILURE_LABEL: Partial<Record<GeminiErrorKind, string>> = {
  busy: 'перегружена',
  unavailable: 'не ответила',
  rate: 'лимит в минуту',
  quota: 'дневной лимит',
};

/** «a, a, b» → «a ×2, b». */
const countList = (items: string[]) =>
  [...Map.groupBy(items, (item) => item)].map(([item, all]) => (all.length > 1 ? `${item} ×${all.length}` : item)).join(', ');

const formatNow = (now: number) =>
  new Intl.DateTimeFormat('ru-RU', { timeZone: constants.timeZone, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(now);

/** Новое сообщение в канале: решаем, отвечать ли, и отвечаем. */
export async function onMessage(message: Message, deps: SvetaDeps = DEFAULT_DEPS): Promise<void> {
  const s = getSettings().sveta;
  const me = message.client.user?.id;
  if (!s.enabled || !me || !message.inGuild()) return;

  const now = deps.now();
  const profanity = getSettings().profanity;
  const scoldKey = `${message.guildId}:${message.author.id}`;
  // Мат от того, кому админы его разрешили: Света ворчит (не чаще раза в scoldMinutes), даже если её не звали.
  const scold =
    !message.author.bot &&
    swearsWithPermission(profanity, message.author.id, message.channelId, message.content) &&
    scolds.due(scoldKey, now, profanity.scoldMinutes);
  const called = triggerOf(
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
  // Не звали, но есть за что поворчать, — отвечает и вне своих каналов, если там можно писать.
  const trigger = called ?? (scold && canReply(message) ? 'swear' : null);
  if (!trigger) return;
  // Обратились к ней (а не встряла сама или ворчит) — тогда объясняет, почему не может ответить, и уведомляет об ответе.
  const addressed = trigger !== 'random' && trigger !== 'swear';

  const keyFor = (model: string) => (isOpenRouterModel(model) ? deps.openrouterKey() : deps.apiKey());
  // Основная и запасная — только те, для которых есть ключ.
  const models = [s.model, s.fallbackModel].filter((m) => m && keyFor(m));

  const quiet = { parse: [] as never[], repliedUser: false };
  // Сообщение могли удалить, пока Света думала (например, фильтр мата), — тогда ответ уходит без привязки, а не с ошибкой.
  const respond = (payload: MessageReplyOptions) => message.reply({ ...payload, failIfNotExists: false });
  const authorName = message.member?.displayName ?? message.author.displayName;
  // Поворчать можно и без модели — заготовленной фразой.
  const scoldByLine = async () => {
    scolds.record(scoldKey, now);
    await respond({ content: scoldLine(deps.random()), allowedMentions: quiet });
    console.log(`🤬 Света поворчала заготовкой на мат: ${authorName}.`);
  };

  if (!models.length) {
    noteError(`нет ключа: для ${s.model} впиши ${keyName(s.model)} в .env и перезапусти бота.`, now);
    if (scold) await scoldByLine();
    return;
  }

  // «Что ты обо мне помнишь» и «забудь меня» — отвечает код: точно, без запроса к Gemini и без лимитов.
  const command = addressed ? memoryCommand(message.content) : null;
  if (command === 'ask') {
    await respond({ content: memoryReport(getPerson(message.guildId, message.author.id)), allowedMentions: quiet });
    return;
  }
  if (command === 'forget') {
    const forgotten = forgetPerson(message.guildId, message.author.id);
    await respond({ content: forgotten ? FORGOTTEN : NOTHING_TO_FORGET, allowedMentions: quiet });
    if (forgotten) console.log(`🧹 Света стёрла память по просьбе: ${authorName}.`);
    return;
  }

  // Все модели отдыхают после лимита или сбоя — никуда не стучимся, позвавшему раз в час «перерыв».
  const verdict = readyModels(models, rest, now).length ? limiter.check(trigger, message.author.id, message.channelId, now, s) : 'paused';
  if (verdict !== 'ok') {
    if (scold) return scoldByLine();
    // Позвали, а ответить нельзя: один раз в час говорим, что на перерыве; в остальных случаях молчим.
    const breakKind = verdict === 'hour' || verdict === 'day' || verdict === 'paused' ? verdict : null;
    if (addressed && breakKind && limiter.shouldNotice(message.channelId, now)) {
      await respond({ content: BREAK_LINES[breakKind], allowedMentions: quiet });
    }
    return;
  }
  limiter.record(message.author.id, message.channelId, now);
  if (scold) scolds.record(scoldKey, now);

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
    scold,
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
  let model = s.model;
  const failures: string[] = [];
  // Расход этого ответа по моделям: попытки (и неудачные) и токены — для страницы «Света» и строки в логе.
  const spend = new Map<string, Spend>();
  const addTo = (name: string, more: Spend) => spend.set(name, addSpend(spend.get(name) ?? NO_SPEND, more));
  const steady = {
    generate: deps.generate,
    wait: deps.wait,
    now: deps.now,
    rest,
    fallback: s.fallbackModel,
    keyFor,
    // Перед каждой попыткой — заново «печатает…»: повтор и запасная модель могут занять время.
    onAttempt: (attempted: string) => {
      addTo(attempted, { ...NO_SPEND, requests: 1 });
      if (requests++) void message.channel.sendTyping().catch(() => {});
    },
    onFailure: (failed: string, error: GeminiError) => {
      failures.push(`${failed} — ${FAILURE_LABEL[error.kind] ?? error.kind}`);
      // Ответ модели целиком в лог (одинаковый — не чаще раза в час): видно, какой лимит или ошибка и у какой модели,
      // даже если запасная потом ответила.
      noteError(`${failed}, ${FAILURE_LABEL[error.kind] ?? error.kind}: ${error.message.slice(0, 300)}`, deps.now());
    },
  };
  try {
    // Модель может попросить инструменты (состав реги, расписание): бот выполняет их и спрашивает ещё раз.
    // Не больше MAX_TOOL_ROUNDS кругов, на последнем — только текст.
    let reply: GeminiReply;
    for (let round = 0; ; round++) {
      const last = round >= MAX_TOOL_ROUNDS;
      const answer = await generateSteady(
        { apiKey: '', model, system, contents, tools: [...TOOLS, ...MEMORY_TOOLS], toolMode: last ? 'NONE' : 'AUTO', thinking: s.thinking },
        steady,
      );
      // Перешли на запасную модель — остальные круги этого ответа тоже к ней.
      ({ reply, model } = answer);
      if (reply.usage) addTo(model, { requests: 0, ...reply.usage });
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
    if (!text) {
      if (scold) await scoldByLine();
      return;
    }
    // Кто позвал — получит уведомление об ответе; если встряла сама или ворчит — без уведомления.
    await respond({ content: text, allowedMentions: { parse: [], repliedUser: addressed } });
    const channel = 'name' in message.channel ? `#${message.channel.name}` : message.channelId;
    const total = [...spend.values()].reduce(addSpend, NO_SPEND);
    const details = [
      TRIGGER_LABEL[trigger],
      scold && trigger !== 'swear' ? TRIGGER_LABEL.swear : '',
      `запросов: ${requests}`,
      failures.length ? `сбои: ${countList(failures)}` : '',
      model !== s.model ? `ответила ${model}` : '',
      used.length ? `инструменты: ${[...new Set(used)].join(', ')}` : '',
      total.input || total.output ? `токенов: ${total.input} → ${total.output}` : '',
      total.cost !== null ? `стоимость: ${formatCost(total.cost)}` : '',
    ];
    console.log(`💬 Света ответила в ${channel} (${details.filter(Boolean).join(', ')}).`);
  } catch (error) {
    if (!(error instanceof GeminiError)) throw error;
    // Ворчит заготовкой — тогда объяснять, почему модель не ответила, не нужно.
    if (scold) await scoldByLine();
    const explain = addressed && !scold;
    if (error.kind === 'quota' || error.kind === 'rate') {
      // Лимит у всех моделей: они отдыхают (ModelRest), текст Google уже в логе.
      if (explain && limiter.shouldNotice(message.channelId, now)) await respond({ content: BREAK_LINES.paused, allowedMentions: quiet });
    } else if (error.kind === 'blocked') {
      if (explain) await respond({ content: 'Не-не, такое я обсуждать не буду 😅', allowedMentions: quiet });
    } else {
      // Сюда сбой Google доходит, только когда не помогли ни повтор, ни запасная модель.
      const outage = error.kind === 'busy' || error.kind === 'unavailable';
      noteError(outage ? `${ERROR_TEXT[error.kind]}: ${error.message}` : ERROR_TEXT[error.kind], now);
      // Google не ответил — позвавший не должен ждать в тишине.
      if (outage && explain) {
        await respond({ content: 'Что-то я задумалась 🤔 Спроси ещё раз чуть позже.', allowedMentions: quiet });
      }
    }
  } finally {
    if (requests) countRequests(dayKey(now), requests);
    for (const [name, used] of spend) countSpend(dayKey(now), name, used);
  }
}

/** Доллары коротко для лога: 0 — «бесплатно», иначе три значащие цифры ($0.00123). */
const formatCost = (cost: number) => (cost === 0 ? 'бесплатно' : `$${Number(cost.toPrecision(3))}`);

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
  /** Есть ли OPENROUTER_API_KEY (нужен моделям с «/» в имени). */
  hasOpenRouterKey: boolean;
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
  /** Расход по моделям за последние SPEND_DAYS дней (с сегодняшним), свежие дни сверху. */
  spend: ({ day: string; model: string } & Spend)[];
  lastError: { at: number; text: string } | null;
}

/** Сколько дней расхода показывать в админке. */
const SPEND_DAYS = 7;

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
    hasOpenRouterKey: Boolean(config.openrouterApiKey),
    connected: Boolean(ready),
    tag: ready?.user.tag ?? null,
    inviteUrl: ready ? svetaInviteUrl(ready.application.id) : null,
    onServer: Boolean(guild),
    channelsWithoutAccess,
    today: repliesOn(dayKey(Date.now())),
    requestsToday: requestsOn(dayKey(Date.now())),
    spend: spendSince(dayKey(Date.now() - (SPEND_DAYS - 1) * 24 * HOUR)),
    lastError,
  };
}
