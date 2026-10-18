// Создание реги по шагам в личке (как в Raid-Helper): /raid create → бот пишет в ЛС и по очереди спрашивает
// название, описание, дату, время и картинку, потом показывает предпросмотр с кнопкой «Опубликовать».
// Состояние — в черновике (raid_drafts), у кнопок префикс rwiz, поэтому всё переживает перезапуск бота.
import { extname } from 'node:path';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
  StringSelectMenuBuilder,
  type Client,
  type Message,
  type MessageComponentInteraction,
  type MessageCreateOptions,
  type User,
} from 'discord.js';
import { getSettings } from '../botSettings.ts';
import { download } from '../lib/download.ts';
import { parseDate, parseTime, toEpochMs } from '../lib/time.ts';
import { settings } from '../settings.ts';
import { deleteDraft, getDraft, isExpired, purgeExpiredDrafts, saveDraft, type DraftStep, type RaidDraft } from './drafts.ts';
import { buildRaidMessage, hasDefaultBanner } from './render.ts';
import { RAID_PUBLISH_PERMISSIONS, publishRaid, raidUrl } from './service.ts';
import { NO_LIMITS } from './kinds.ts';
import type { Raid, RaidImage } from './store.ts';

export const WIZARD_PREFIX = 'rwiz';
/** Кто может создавать реги — то же право, что у команды /raid. */
export const RAID_CREATE_PERMISSION = PermissionFlagsBits.ManageEvents;

const STEPS: DraftStep[] = ['title', 'description', 'date', 'time', 'image'];
const STEP_TITLES: Record<DraftStep, string> = {
  title: 'Название',
  description: 'Описание',
  date: 'Дата',
  time: 'Время',
  image: 'Картинка',
  confirm: 'Предпросмотр',
};
const LIMITS = { title: 100, description: 1000, image: 8 * 1024 * 1024 };
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const QUICK_TIMES = ['19:00', '19:30', '20:00', '20:30', '21:00'];
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const ACCENT = 0xc69b3a;
const EXPIRED = 'Черновик реги устарел (больше 2 часов без ответа). Начни заново: `/raid create` на сервере.';

// --- Шаги (чистая логика: черновик + ответ → новый черновик или ошибка) ---

export type StepResult = { ok: true; draft: RaidDraft } | { ok: false; error: string };
const ok = (draft: RaidDraft): StepResult => ({ ok: true, draft });
const fail = (error: string): StepResult => ({ ok: false, error });

export function newDraft(init: Pick<RaidDraft, 'userId' | 'guildId' | 'channelId' | 'pingRoleId' | 'size' | 'leaderName'>): RaidDraft {
  return { ...init, step: 'title', title: null, description: null, date: null, time: null, image: null, editing: false, promptMessageId: null, updatedAt: Date.now() };
}

/** Ответ на шаг принят: дальше по порядку, а если предпросмотр уже был — сразу к нему. */
function advance(draft: RaidDraft): StepResult {
  const next = draft.editing ? 'confirm' : (STEPS[STEPS.indexOf(draft.step) + 1] ?? 'confirm');
  return ok({ ...draft, step: next, editing: draft.editing || next === 'confirm' });
}

const todayAt = (now: number) => Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(settings.timeZone).toPlainDate();
const pad = (n: number) => String(n).padStart(2, '0');
const shortDay = (date: Temporal.PlainDate) => `${WEEKDAYS[date.dayOfWeek - 1]} ${pad(date.day)}.${pad(date.month)}`;

/** Когда начинается рейд из черновика (null — дата или время ещё не выбраны). */
export function startsAtOf(draft: RaidDraft): number | null {
  if (!draft.date || !draft.time) return null;
  return toEpochMs(Temporal.PlainDate.from(draft.date), Temporal.PlainTime.from(draft.time));
}

export function setDate(draft: RaidDraft, input: string, now: number): StepResult {
  const today = todayAt(now);
  const date = parseDate(input, today);
  if (!date) return fail(`Не понял дату «${input}». Примеры: сегодня, завтра, 17.10, 17.10.2026.`);
  if (Temporal.PlainDate.compare(date, today) < 0) return fail('Эта дата уже прошла — выбери сегодняшнюю или будущую.');
  if (draft.time && toEpochMs(date, Temporal.PlainTime.from(draft.time)) <= now) {
    return fail(`${shortDay(date)} в ${draft.time} уже прошло — выбери другую дату или потом поменяй время.`);
  }
  return advance({ ...draft, date: date.toString() });
}

export function setTime(draft: RaidDraft, input: string, now: number): StepResult {
  const time = parseTime(input);
  if (!time) return fail(`Не понял время «${input}». Пример: 20:00.`);
  const value = `${pad(time.hour)}:${pad(time.minute)}`;
  if (draft.date && toEpochMs(Temporal.PlainDate.from(draft.date), time) <= now) return fail('Это время уже прошло — укажи будущее.');
  return advance({ ...draft, time: value });
}

export function setImage(draft: RaidDraft, image: RaidImage | null): StepResult {
  return advance({ ...draft, image });
}

/** Ответ текстом на текущий шаг. */
export function applyText(draft: RaidDraft, input: string, now = Date.now()): StepResult {
  const value = input.trim();
  switch (draft.step) {
    case 'title':
      if (!value) return fail('Название не может быть пустым.');
      if (value.length > LIMITS.title) return fail(`Название — не длиннее ${LIMITS.title} символов (сейчас ${value.length}).`);
      return advance({ ...draft, title: value });
    case 'description':
      if (value.length > LIMITS.description) return fail(`Описание — не длиннее ${LIMITS.description} символов (сейчас ${value.length}).`);
      return advance({ ...draft, description: value || null });
    case 'date':
      return setDate(draft, value, now);
    case 'time':
      return setTime(draft, value, now);
    case 'image':
      return fail('Пришли картинку файлом (прикрепи к сообщению) или нажми кнопку под вопросом.');
    case 'confirm':
      return fail('Всё готово — выбери действие кнопками под предпросмотром.');
  }
}

// --- Как выглядит шаг ---

const button = (id: string, label: string, style = ButtonStyle.Secondary) =>
  new ButtonBuilder().setCustomId(`${WIZARD_PREFIX}:${id}`).setLabel(label).setStyle(style);

function navigation(draft: RaidDraft): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (draft.editing) row.addComponents(button('preview', 'К предпросмотру'));
  else if (draft.step !== 'title') row.addComponents(button('back', '← Назад'));
  return row.addComponents(button('cancel', 'Отмена', ButtonStyle.Danger));
}

function question(draft: RaidDraft, banner: boolean): string {
  // При правке из предпросмотра показываем, что выбрано сейчас.
  const current = (value: string | null) => (value ? `\n\nСейчас: ${value}` : '');
  switch (draft.step) {
    case 'title':
      return `Как назовём рейд? Напиши название, например **Огненные Недра** или **Логово Ониксии**.${current(draft.title && `**${draft.title}**`)}`;
    case 'description':
      return `Напиши описание: время сбора, требования, что взять с собой. Можно в несколько строк, до ${LIMITS.description} символов.\nНе нужно — нажми «Без описания».${current(draft.description)}`;
    case 'date':
      return `Какого числа рейд? Нажми кнопку или напиши дату: **сегодня**, **завтра**, **17.10**, **17.10.2026**.${current(draft.date && shortDay(Temporal.PlainDate.from(draft.date)))}`;
    case 'time':
      return `Во сколько начало (по киевскому времени)? Нажми кнопку или напиши время, например **20:00**.${current(draft.time)}`;
    case 'image':
      return (
        `Пришли картинку для реги — прикрепи файл (до 8 МБ) к сообщению.\n` +
        (banner ? 'Без своей картинки будет стандартный фон.' : 'Можно и без картинки.') +
        current(draft.image && 'своя картинка')
      );
    case 'confirm':
      return '';
  }
}

/** Сообщение с вопросом текущего шага (или предпросмотр реги с кнопками публикации). */
export function buildPrompt(draft: RaidDraft, now = Date.now(), banner = hasDefaultBanner()): MessageCreateOptions {
  if (draft.step === 'confirm') return buildPreview(draft);

  const number = STEPS.indexOf(draft.step) + 1;
  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle(`Новая рега · шаг ${number} из ${STEPS.length} — ${STEP_TITLES[draft.step]}`)
    .setDescription(question(draft, banner))
    .setFooter({ text: 'Отвечай сообщением сюда. Черновик хранится 2 часа.' });

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  if (draft.step === 'description') rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(button('nodesc', 'Без описания')));
  if (draft.step === 'date') {
    const today = todayAt(now);
    const days = [0, 1, 2, 3, 4].map((offset) => today.add({ days: offset }));
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        days.map((day, i) =>
          button(`date:${day.toString()}`, i === 0 ? 'Сегодня' : i === 1 ? 'Завтра' : shortDay(day), draft.date === day.toString() ? ButtonStyle.Primary : ButtonStyle.Secondary),
        ),
      ),
    );
  }
  if (draft.step === 'time') {
    const fallback = getSettings().raids.defaultTime;
    const times = QUICK_TIMES.includes(fallback) ? QUICK_TIMES : [...QUICK_TIMES.slice(0, 4), fallback].sort();
    const selected = draft.time ?? fallback;
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(times.map((t) => button(`time:${t}`, t, t === selected ? ButtonStyle.Primary : ButtonStyle.Secondary))));
  }
  if (draft.step === 'image') {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(button('noimage', banner ? 'Стандартный фон' : 'Без картинки')));
  }
  rows.push(navigation(draft));
  return { embeds: [embed], components: rows, allowedMentions: { parse: [] } };
}

function previewRaid(draft: RaidDraft): Raid {
  return {
    id: 0,
    guildId: draft.guildId,
    channelId: draft.channelId,
    messageId: null,
    title: draft.title ?? '',
    description: draft.description,
    startsAt: startsAtOf(draft) ?? Date.now(),
    size: draft.size,
    createdBy: draft.userId,
    leaderName: draft.leaderName,
    status: 'open',
    mainRoleIds: [],
    reserveRoleIds: [],
    kind: 'raid',
    limits: NO_LIMITS,
    player: false,
  };
}

function buildPreview(draft: RaidDraft): MessageCreateOptions {
  const { embeds, files } = buildRaidMessage(previewRaid(draft), [], draft.image);
  embeds.at(-1)!.setFooter({ text: 'Предпросмотр — номер реги появится после публикации' });
  const edit = new StringSelectMenuBuilder()
    .setCustomId(`${WIZARD_PREFIX}:edit`)
    .setPlaceholder('Изменить…')
    .addOptions(STEPS.map((step) => ({ label: STEP_TITLES[step], value: step })));
  return {
    content: `**Предпросмотр** — так рега будет выглядеть в <#${draft.channelId}>${draft.pingRoleId ? ` (с упоминанием <@&${draft.pingRoleId}>)` : ''}. Проверь и нажми «Опубликовать».`,
    embeds,
    files,
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(button('publish', 'Опубликовать', ButtonStyle.Success), button('cancel', 'Отмена', ButtonStyle.Danger)),
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(edit),
    ],
    allowedMentions: { parse: [] },
  };
}

// --- Discord: личка, кнопки, публикация ---

const isDmClosed = (error: unknown) => (error as { code?: unknown } | null)?.code === RESTJSONErrorCodes.CannotSendMessagesToThisUser;

/** Ответы одного человека обрабатываем строго по очереди: два быстрых сообщения не должны перепутать шаги. */
const queues = new Map<string, Promise<unknown>>();
function inQueue<T>(userId: string, task: () => Promise<T>): Promise<T> {
  const run = (queues.get(userId) ?? Promise.resolve()).then(task, task);
  const tail = run.catch(() => {});
  queues.set(userId, tail);
  void tail.then(() => {
    if (queues.get(userId) === tail) queues.delete(userId);
  });
  return run;
}

/** Убрать кнопки у прошлого сообщения мастера — нажимать их больше не нужно. */
async function stripButtons(user: User, messageId: string | null): Promise<void> {
  if (!messageId) return;
  const channel = user.dmChannel ?? (await user.createDM().catch(() => null));
  await channel?.messages.edit(messageId, { components: [] }).catch(() => {});
}

/** Сохранить черновик и прислать следующий шаг. */
async function showStep(user: User, draft: RaidDraft): Promise<void> {
  const saved = saveDraft(draft);
  const message = await user.send(buildPrompt(saved));
  saveDraft({ ...saved, promptMessageId: message.id });
}

export type StartResult = { ok: true; url: string; replaced: boolean } | { ok: false };

/** Начать создание реги: черновик и первый шаг в личку. ok: false — у человека закрыта личка. */
export async function startRaidWizard(user: User, init: Parameters<typeof newDraft>[0]): Promise<StartResult> {
  return inQueue(user.id, async () => {
    purgeExpiredDrafts();
    const old = getDraft(user.id);
    if (old) await stripButtons(user, old.promptMessageId);
    const draft = saveDraft(newDraft(init));
    try {
      const message = await user.send(buildPrompt(draft));
      saveDraft({ ...draft, promptMessageId: message.id });
      return { ok: true, url: message.url, replaced: old !== null };
    } catch (error) {
      deleteDraft(user.id);
      if (isDmClosed(error)) return { ok: false };
      throw error;
    }
  });
}

/** Ответ текстом (или картинкой) в личку бота. */
async function onDirectMessage(message: Message): Promise<void> {
  const draft = getDraft(message.author.id);
  if (!draft) return; // обычная переписка с ботом — не мешаем
  if (isExpired(draft)) {
    deleteDraft(draft.userId);
    await message.reply(EXPIRED);
    return;
  }

  let result: StepResult;
  const picture = message.attachments.find((a) => a.contentType?.startsWith('image/') ?? false);
  if (draft.step === 'image' && picture) {
    const ext = extname(picture.name).toLowerCase();
    result =
      picture.size > LIMITS.image
        ? fail('Картинка больше 8 МБ — пришли поменьше.')
        : setImage(draft, { name: `raid-image${IMAGE_EXTENSIONS.has(ext) ? ext : '.png'}`, data: await download(picture.url) });
  } else {
    result = applyText(draft, message.content);
  }

  if (!result.ok) {
    await message.reply(`⚠️ ${result.error}`);
    return;
  }
  await stripButtons(message.author, draft.promptMessageId);
  await showStep(message.author, result.draft);
}

export function registerRaidWizard(client: Client): void {
  client.on(Events.MessageCreate, (message) => {
    if (message.inGuild() || message.author.bot) return;
    inQueue(message.author.id, () => onDirectMessage(message)).catch((error) => console.error('Создание реги в личке:', error));
  });
}

/** Кнопки и меню мастера (приходят из лички, без сервера). */
export const raidWizardHandler = {
  prefix: WIZARD_PREFIX,
  handle(interaction: MessageComponentInteraction, args: string[]): Promise<void> {
    return inQueue(interaction.user.id, () => onComponent(interaction, args));
  },
};

async function onComponent(interaction: MessageComponentInteraction, [action = '', value = '']: string[]): Promise<void> {
  const draft = getDraft(interaction.user.id);
  if (!draft || interaction.message.id !== draft.promptMessageId || isExpired(draft)) {
    if (draft && isExpired(draft)) deleteDraft(draft.userId);
    await interaction.update({ components: [] });
    const text = !draft
      ? 'Эта рега уже опубликована или отменена. Новая — `/raid create` на сервере.'
      : isExpired(draft)
        ? EXPIRED
        : 'Это старый шаг — продолжай в последнем сообщении бота.';
    await interaction.followUp({ content: text });
    return;
  }

  if (action === 'cancel') {
    deleteDraft(draft.userId);
    await interaction.update({ content: '🚫 Создание реги отменено.', components: [] });
    return;
  }
  if (action === 'publish') return publish(interaction, draft);

  const now = Date.now();
  const back = draft.step === 'confirm' ? 'image' : STEPS[STEPS.indexOf(draft.step) - 1];
  const chosen = interaction.isStringSelectMenu() ? (interaction.values[0] as DraftStep) : undefined;
  let result: StepResult;
  if (action === 'back') result = back ? ok({ ...draft, step: back }) : fail('Это первый шаг.');
  else if (action === 'preview') result = ok({ ...draft, step: 'confirm' });
  else if (action === 'edit') result = chosen && STEPS.includes(chosen) ? ok({ ...draft, step: chosen }) : fail('Не понял, что изменить.');
  else if (action === 'nodesc' && draft.step === 'description') result = advance({ ...draft, description: null });
  else if (action === 'date' && draft.step === 'date') result = setDate(draft, value, now);
  else if (action === 'time' && draft.step === 'time') result = setTime(draft, value, now);
  else if (action === 'noimage' && draft.step === 'image') result = setImage(draft, null);
  else result = fail('Эта кнопка сейчас не к месту — ответь на текущий шаг.');

  if (!result.ok) {
    await interaction.reply({ content: `⚠️ ${result.error}` });
    return;
  }
  await interaction.update({ components: [] }); // кнопки пройденного шага больше не нужны
  await showStep(interaction.user, result.draft);
}

/** «Опубликовать»: перепроверить всё на сервере и выложить регу в выбранный канал. */
async function publish(interaction: MessageComponentInteraction, draft: RaidDraft): Promise<void> {
  const startsAt = startsAtOf(draft);
  const guild = interaction.client.guilds.cache.get(draft.guildId);
  const channel = guild?.channels.cache.get(draft.channelId);
  const member = guild ? await guild.members.fetch(draft.userId).catch(() => null) : null;
  const me = guild?.members.me;

  let problem: string | null = null;
  if (!draft.title || startsAt === null) problem = 'Не хватает названия, даты или времени — выбери «Изменить…».';
  else if (startsAt <= Date.now()) problem = 'Время рейда уже прошло — выбери «Изменить…» → Дата или Время.';
  else if (!guild || !channel?.isTextBased() || channel.isDMBased()) problem = 'Канал для реги больше недоступен — начни заново: `/raid create`.';
  else if (!member?.permissions.has(RAID_CREATE_PERMISSION)) problem = 'На сервере у тебя больше нет права создавать реги.';
  else if (me && !channel.permissionsFor(me)?.has(RAID_PUBLISH_PERMISSIONS)) {
    problem = `В #${channel.name} мне нужны права: видеть канал, отправлять сообщения, встраивать ссылки и прикреплять файлы.`;
  }
  if (problem || !channel?.isTextBased() || channel.isDMBased() || startsAt === null) {
    await interaction.reply({ content: `⚠️ ${problem ?? 'Не получилось опубликовать.'}` });
    return;
  }

  // Публикация с картинкой может занять больше 3 секунд — сначала подтверждаем нажатие.
  await interaction.deferUpdate();
  try {
    const raid = await publishRaid(
      channel,
      { title: draft.title!, description: draft.description, startsAt, size: draft.size, createdBy: draft.userId, leaderName: member?.displayName ?? draft.leaderName },
      draft.pingRoleId ? [draft.pingRoleId] : [],
      draft.image,
    );
    deleteDraft(draft.userId);
    await interaction.editReply({ content: `✅ Рега #${raid.id} опубликована в <#${channel.id}>: ${raidUrl(raid)}`, components: [] });
  } catch (error) {
    console.error('Не удалось опубликовать регу из лички:', error);
    await interaction.followUp({ content: '😕 Не получилось опубликовать — подробности в консоли бота. Черновик сохранён, можно попробовать ещё раз.' });
  }
}
