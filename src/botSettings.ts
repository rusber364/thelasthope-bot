// Настройки, которые меняются из админки: каналы, роли, тексты приветствия, расписание рег, лог-каналы.
// Хранятся в базе одним JSON (таблица settings, ключ "bot"). Читай их через getSettings()
// в момент использования — тогда изменения из админки действуют сразу, без перезапуска.
//
// Откуда берутся значения: умолчания ниже ← ID из .env (как было до админки) ← сохранённое в базе.
import { config } from './config.ts';
import { db } from './db.ts';
import { parseTime } from './lib/time.ts';
import { KINDS, LIMIT_GROUPS, NO_LIMITS, isKind, parseLimits, type ActivityKind, type RoleLimits } from './raids/kinds.ts';
import type { ProfanityLevel } from './lib/profanity.ts';
import { DEFAULT_PERSONA } from './sveta/persona.ts';

export const LOG_CATEGORIES = ['members', 'server', 'messages', 'voice', 'moderation', 'raids'] as const;
export type LogCategory = (typeof LOG_CATEGORIES)[number];

/** Названия лог-каналов, как на сервере, и что в них пишется. */
export const LOG_LABELS: Record<LogCategory, { title: string; hint: string }> = {
  members: { title: 'лог-дискорда', hint: 'вход и выход участников' },
  server: { title: 'лог-сервер', hint: 'каналы, роли, ники, настройки сервера' },
  messages: { title: 'лог-сообщения', hint: 'удалённые и изменённые сообщения' },
  voice: { title: 'лог-голос', hint: 'вход, выход и переходы в голосовых каналах' },
  moderation: { title: 'лог-модерация', hint: 'кики, баны, муты, очистка, мат' },
  raids: { title: 'лог-рейдов', hint: 'запись на реги, смена спека, «под вопросом», отписки' },
};

/** История о человеке (или о чём-то в гильдии) для Светы: по каким именам узнавать и что рассказывать. */
export interface LoreEntry {
  /** Имя и другие ники, твинки — Света вспоминает историю, когда их называют в разговоре. */
  names: string[];
  story: string;
}

export interface SvetaSettings {
  enabled: boolean;
  /** Каналы, где Света читает и отвечает. Остальные каналы в Gemini не уходят. */
  channelIds: string[];
  /** Куда Света пишет новости о сборах: открылась рега, «Сбор!», перенос, отмена (null — не пишет). */
  newsChannelId: string | null;
  /** Характер — начало системной инструкции; правила поведения добавляются к нему всегда. */
  persona: string;
  /** Основная модель: Gemini (gemini-flash-latest) или OpenRouter — с «/» в имени (minimax/minimax-m3.1-flash:free). */
  model: string;
  /** Запасная модель, когда основная перегружена, не отвечает или упёрлась в лимит (пусто — без запасной). */
  fallbackModel: string;
  /** Шанс встрять самой в разговор, % (0 — только когда зовут). */
  randomPercent: number;
  /** Пауза между ответами одному человеку, секунд. */
  userCooldownSeconds: number;
  perHour: number;
  perDay: number;
  /** Истории о людях гильдии от офицеров — Света их только читает. */
  lore: LoreEntry[];
}

export interface Onboarding {
  /** Опрос-анкета (открытый опрос этого сервера); null — анкету не предлагать. */
  pollId: number | null;
  /** Строка в приветствии над кнопкой. Подстановки как у приветствия: {user} {server} {rules} {role}. */
  offer: string;
  /** Подпись кнопки. */
  button: string;
  /** Предлагать анкету и в личку новичку (вместе с приветствием в личку или отдельным сообщением). */
  dm: boolean;
  /** Роль, которую выдать после заполнения анкеты. */
  roleId: string | null;
  /** Роль, которую снять после заполнения (например, «Незнакомец»). */
  removeRoleId: string | null;
  /** Присылать офицерам карточку с ответами в канал оповещений. */
  notify: boolean;
}

/** Липкое сообщение в канале. roleIds — кого упомянуть в начале сообщения. */
export interface StickyItem {
  channelId: string;
  text: string;
  roleIds: string[];
}

/**
 * Строка расписания шаблона: рейд в raidDay в raidTime, рега на него открывается в openDay в openTime
 * (ближайший такой момент до рейда, не дальше недели). Дни: 1 — понедельник … 7 — воскресенье.
 */
export interface RaidSlot {
  raidDay: number;
  raidTime: string;
  openDay: number;
  openTime: string;
}

export type ArchiveMode = 'off' | 'move' | 'delete';

/** Голосовая роль: пока участник в канале channelId, у него есть роль roleId. */
export interface VoiceRoleLink {
  channelId: string;
  roleId: string;
}
export const ARCHIVE_MODES: ArchiveMode[] = ['off', 'move', 'delete'];

/** Автоочистка канала: удалять сообщения старше hours часов (закреплённые — никогда, сообщения бота — если keepBot выключено). */
export interface AutoCleanRule {
  channelId: string;
  hours: number;
  keepBot: boolean;
}

/** Какие сборы игроки открывают сами (/group). Рейды — только офицеры. */
export type PlayerGroupKind = 'dungeon' | 'pvp';
export const PLAYER_GROUP_KINDS: readonly PlayerGroupKind[] = ['dungeon', 'pvp'];

export interface PlayerGroupSettings {
  /** Куда публикуются группы этого вида (null — игроки открывать их не могут). */
  channelId: string | null;
  size: number;
  limits: RoleLimits;
  /** Кто может открывать группы (пусто — любой участник). */
  creatorRoleIds: string[];
}

/** Шаблон рейда: реги по расписанию и создание в два клика из админки. */
export interface RaidTemplate {
  /** Не меняется после создания: по нему находят шаблон и понимают, что рега по расписанию уже открыта. */
  id: string;
  title: string;
  description: string;
  size: number;
  /** Время начала ЧЧ:ММ для реги, созданной вручную. */
  time: string;
  /** Канал рег (null — реги по этому шаблону не открываются). */
  channelId: string | null;
  /** Роли, которые бот упоминает, когда открывает регу. */
  pingRoleIds: string[];
  /** Разослать открытую регу в личку тем, у кого роли из pingRoleIds (с кнопкой «Не присылать мне»). */
  dmOnOpen: boolean;
  /** С какими ролями записываются в основу (пусто — все). */
  mainRoleIds: string[];
  /** С какими ролями записываются только в запас (имеет смысл, только если основа ограничена). */
  reserveRoleIds: string[];
  /** Вид сбора: рейд, подземелье, PvP. */
  kind: ActivityKind;
  /** Мест по ролям в основе: танки, лекари, бойцы (null — без лимита). */
  limits: RoleLimits;
  /** Расписание (пусто — шаблон только для ручного создания). */
  slots: RaidSlot[];
}

export interface BotSettings {
  channels: { welcome: string | null; rules: string | null };
  roles: { guest: string | null; autorole: string | null };
  welcome: {
    /** Подстановки: {user} {server} {rules} {role}. */
    text: string;
    guestOffer: string;
    guestButton: string;
    rulesButton: string;
  };
  raids: {
    defaultSize: number;
    defaultTime: string;
    /** За сколько минут до рейда писать «Сбор!» в канал реги с упоминанием записавшихся. 0 — не писать. */
    gatherMinutes: number;
    /** Через сколько минут после начала рейда проверять, кто в голосовом. 0 — не проверять. */
    attendanceMinutes: number;
    /** Голосовой канал рейда. null — считается любой голосовой канал сервера. */
    attendanceVoiceChannelId: string | null;
    /** Роль, которую получают записавшиеся (null — не выдавать). Снимается через tempRoleHours после начала. */
    tempRoleId: string | null;
    tempRoleHours: number;
    /** Что делать с регой через hours часов после начала: off — ничего, move — в канал-архив, delete — удалить и оставить итог. */
    archive: { mode: ArchiveMode; channelId: string | null; hours: number };
    /** Канал с живым списком ближайших рейдов (null — списка нет). */
    boardChannelId: string | null;
    /** Создавать для каждой реги событие Discord (вкладка «События» сервера). */
    discordEvents: boolean;
  };
  logs: Record<LogCategory, { channelId: string | null; enabled: boolean }>;
  /** Связки «голосовой канал → роль». */
  voiceRoles: VoiceRoleLink[];
  /** Липкие сообщения: текст, который бот держит последним в канале. */
  sticky: { intervalSeconds: number; items: StickyItem[] };
  /** Шаблоны рейдов с расписанием (страница «Рейды» в админке). */
  raidTemplates: RaidTemplate[];
  /** Автоочистка каналов. */
  autoClean: AutoCleanRule[];
  /** Группы, которые открывают сами игроки командой /group: подземелья и PvP. */
  groups: Record<PlayerGroupKind, PlayerGroupSettings>;
  /** Прощание при выходе участника. Подстановки: {user} {name} {server} {members}. */
  farewell: { channelId: string | null; text: string };
  /** Приветствие в личку новичку. Подстановки: {user} {name} {server} {rules} {welcome} {role}. */
  welcomeDm: { enabled: boolean; text: string };
  /** Анкета новичков: опрос, который предлагается в приветствии, и что сделать, когда его заполнили. */
  onboarding: Onboarding;
  /** ИИ-персонаж Света (src/sveta): где живёт, характер, модель и потолки. */
  sveta: SvetaSettings;
  /** Фильтр мата (src/events/profanityFilter.ts): что ловить и что делать с нарушителем. */
  profanity: ProfanitySettings;
  /** Оповещения офицерам: посещаемость, поздние отписки. */
  alerts: {
    channelId: string | null;
    /** Роль, которую упоминать в оповещениях (например, @Офицер). */
    roleId: string | null;
    /** Отписка или «под вопросом» меньше чем за столько часов до рейда — поздняя. 0 — не следить. */
    lateCancelHours: number;
    /** Канал модераторов для карточек инцидентов с кнопками (null — выключено). */
    incidentChannelId: string | null;
  };
}

/** report — только карточка модераторам (сообщение остаётся); delete — удалить с предупреждением; mute — ещё и мут за повторы. */
export type ProfanityAction = 'report' | 'delete' | 'mute';
export const PROFANITY_LEVELS: readonly ProfanityLevel[] = ['mat', 'rude'];
export const PROFANITY_ACTIONS: readonly ProfanityAction[] = ['report', 'delete', 'mute'];

export interface ProfanitySettings {
  enabled: boolean;
  /** mat — только мат и оскорбления по национальности и ориентации; rude — ещё и грубые слова (сука, мудак…). */
  level: ProfanityLevel;
  action: ProfanityAction;
  /** Мут (action = mute): столько нарушений за strikeWindowMinutes — мут на muteMinutes. */
  strikesToMute: number;
  strikeWindowMinutes: number;
  muteMinutes: number;
  /** Через сколько секунд убрать предупреждение в чате (0 — не предупреждать). */
  warningSeconds: number;
  /** Каналы, где фильтр не работает. */
  ignoredChannelIds: string[];
  /** Свои слова: ловятся как начало слова, на любом уровне. */
  extraWords: string[];
}

export const LIMITS = { profanityChannels: 25, profanityWords: 50, profanityWord: 30, strikes: 20, strikeWindow: 1440, muteMinutes: 10080, warningSeconds: 60, lore: 50, loreNames: 10, loreName: 40, loreStory: 1000, svetaChannels: 10, persona: 4000, randomPercent: 20, svetaCooldown: 600, svetaPerHour: 500, svetaPerDay: 5000, text: 2000, button: 80, title: 100, size: 100, gather: 120, attendance: 180, lateHours: 72, tempRoleHours: 48, archiveHours: 72, stickyMin: 5, stickyMax: 600, stickyText: 1800, stickyRoles: 5, templates: 25, templateDescription: 1000, slots: 14, templateRoles: 10, autoCleanHours: 720, autoCleanChannels: 20 };

function defaults(): BotSettings {
  const env = (value: string | undefined) => value ?? null;
  return {
    channels: { welcome: env(config.welcomeChannelId), rules: env(config.rulesChannelId) },
    roles: { guest: env(config.guestRoleId), autorole: env(config.autoroleId) },
    welcome: {
      text:
        '{user}, добро пожаловать в **{server}**! Ознакомься с {rules}. ' +
        'За любой информацией пиши офицерам! До встречи в Азероте! За Азерот и за Альянс! 🫡',
      guestOffer: 'Хочешь получить роль **{role}**? Нажми кнопку ниже — бот выдаст её сразу.',
      guestButton: 'Получить роль «{role}»',
      rulesButton: 'Правила',
    },
    raids: {
      defaultSize: 40,
      defaultTime: '20:00',
      gatherMinutes: 15,
      attendanceMinutes: 15,
      attendanceVoiceChannelId: null,
      tempRoleId: null,
      tempRoleHours: 3,
      archive: { mode: 'off', channelId: null, hours: 6 },
      boardChannelId: null,
      discordEvents: true,
    },
    logs: {
      members: { channelId: null, enabled: true },
      server: { channelId: null, enabled: true },
      messages: { channelId: null, enabled: true },
      voice: { channelId: null, enabled: true },
      moderation: { channelId: env(config.modLogChannelId), enabled: true },
      raids: { channelId: null, enabled: true },
    },
    alerts: { channelId: null, roleId: null, lateCancelHours: 3, incidentChannelId: null },
    profanity: {
      enabled: true,
      level: 'rude',
      action: 'mute',
      strikesToMute: 3,
      strikeWindowMinutes: 10,
      muteMinutes: 10,
      warningSeconds: 8,
      ignoredChannelIds: [],
      extraWords: [],
    },
    voiceRoles: [],
    sticky: { intervalSeconds: 15, items: [] },
    raidTemplates: [defaultGroup('group1', 'Рейд — группа 1', env(config.raidChannel1Id)), defaultGroup('group2', 'Рейд — группа 2', env(config.raidChannel2Id))],
    autoClean: [],
    groups: {
      dungeon: { channelId: null, size: 5, limits: { tank: 1, healer: 1, dps: 3 }, creatorRoleIds: [] },
      pvp: { channelId: null, size: 10, limits: NO_LIMITS, creatorRoleIds: [] },
    },
    farewell: { channelId: null, text: '**{name}** покидает {server}. Удачи в Азероте! 👋 Нас теперь {members}.' },
    welcomeDm: {
      enabled: false,
      text:
        'Привет, {name}! 👋 Добро пожаловать в **{server}** — гильдию Альянса в Warcraft Forever.\n\n' +
        'Что сделать первым делом:\n1. Прочитай {rules}.\n2. Возьми роль «{role}» кнопкой в {welcome}.\n\n' +
        'Есть вопросы — пиши офицерам. До встречи в Азероте! ⚔️',
    },
    onboarding: {
      pollId: null,
      offer: 'Расскажи о себе — займёт пару минут: кем хочешь играть и когда бываешь онлайн. Так офицеры быстрее позовут тебя в рейд.',
      button: 'Пройти анкету',
      dm: true,
      roleId: null,
      removeRoleId: null,
      notify: true,
    },
    sveta: {
      enabled: false,
      channelIds: [],
      newsChannelId: null,
      persona: DEFAULT_PERSONA,
      model: 'gemini-flash-latest',
      fallbackModel: 'gemini-flash-lite-latest',
      randomPercent: 2,
      userCooldownSeconds: 15,
      perHour: 40,
      perDay: 300,
      lore: [],
    },
  };
}

/** Группа по умолчанию: рейды в чт, пт и пн в 20:00, рега открывается в тот же день в 00:00. */
function defaultGroup(id: string, title: string, channelId: string | null): RaidTemplate {
  const slots = [4, 5, 1].map((day) => ({ raidDay: day, raidTime: '20:00', openDay: day, openTime: '00:00' }));
  return { id, title, description: '', size: 40, time: '20:00', channelId, pingRoleIds: [], dmOnOpen: false, mainRoleIds: [], reserveRoleIds: [], kind: 'raid', limits: NO_LIMITS, slots };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * До шаблонов с расписанием реги открывались по raids.schedules: дни открытия и один сдвиг «рейд через N дней».
 * Переносим их в шаблоны с тем же id (ключи уже открытых рег совпадут) — до merge(), который отбросил бы старый ключ.
 */
function migrateSchedules(saved: unknown): unknown {
  if (!isObject(saved) || !isObject(saved.raids) || !Array.isArray(saved.raids.schedules)) return saved;
  const { schedules, ...raids } = saved.raids;
  const templates = Array.isArray(saved.raidTemplates) ? saved.raidTemplates : [];
  const taken = new Set(templates.map((t) => (isObject(t) ? t.id : null)));
  const size = typeof raids.defaultSize === 'number' ? raids.defaultSize : defaults().raids.defaultSize;
  const converted = schedules.filter(isObject).filter((s) => !taken.has(s.id)).map((s) => {
    const offset = Number(s.raidDayOffset) || 0;
    const days = Array.isArray(s.days) ? s.days.map(Number) : [];
    return {
      id: s.id,
      title: s.title,
      description: '',
      size,
      time: s.raidTime,
      channelId: s.channelId ?? null,
      pingRoleIds: s.pingRoleId ? [s.pingRoleId] : [],
      dmOnOpen: false,
      mainRoleIds: [],
      reserveRoleIds: [],
      slots: days.map((day) => ({ raidDay: ((day - 1 + offset) % 7) + 1, raidTime: s.raidTime, openDay: day, openTime: s.openAt })),
    };
  });
  return { ...saved, raids, raidTemplates: [...templates, ...converted] };
}

/** Сохранённое поверх умолчаний: объекты сливаются по ключам, массивы и значения заменяются целиком. */
function merge<T>(base: T, saved: unknown): T {
  if (!isObject(base) || !isObject(saved)) return (saved === undefined ? base : saved) as T;
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(saved)) {
    if (key in result) result[key] = merge(result[key], value);
  }
  return result as T;
}

let cache: BotSettings | null = null;

export function getSettings(): BotSettings {
  if (cache) return cache;
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('bot') as { value: string } | undefined;
  let saved: unknown;
  try {
    saved = row ? JSON.parse(row.value) : undefined;
  } catch {
    console.error('Настройки в базе повреждены — использую значения по умолчанию.');
  }
  const merged = merge(defaults(), migrateSchedules(saved));
  // Массивы из базы заменяют умолчания целиком — дополняем элементы полями, которых не было в старых версиях.
  merged.raidTemplates = merged.raidTemplates.map(({ pingRoleId, ...template }: RaidTemplate & { pingRoleId?: string | null }) => ({
    ...template,
    pingRoleIds: template.pingRoleIds ?? (pingRoleId ? [pingRoleId] : []),
    dmOnOpen: template.dmOnOpen === true,
    mainRoleIds: template.mainRoleIds ?? [],
    reserveRoleIds: template.reserveRoleIds ?? [],
    kind: isKind(template.kind) ? template.kind : 'raid',
    limits: parseLimits(template.limits),
    slots: template.slots ?? [],
  }));
  merged.sticky.items = merged.sticky.items.map((item) => ({ ...item, roleIds: item.roleIds ?? [] }));
  // Канала авторизации больше нет: из стандартных текстов прошлых версий убираем шаг «пройди {auth}».
  merged.welcome.text = merged.welcome.text.replace(' и пройди {auth}', '');
  merged.welcomeDm.text = merged.welcomeDm.text.replace('\n2. Пройди {auth}.\n3. ', '\n2. ');
  cache = merged;
  return cache;
}

/** Сохраняет настройки целиком. Перед этим проверь их через validateSettings(). */
export function saveSettings(next: BotSettings): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(
    'bot',
    JSON.stringify(next),
  );
  cache = structuredClone(next);
}

/** Сбросить кэш (для тестов). */
export function resetSettingsCache(): void {
  cache = null;
}

/** Лимиты по ролям: целые от 0 до LIMITS.size, в сумме не больше мест в составе. */
export function limitErrors(name: string, limits: RoleLimits, size: number): string[] {
  const errors: string[] = [];
  for (const { group, title } of LIMIT_GROUPS) {
    const n = limits[group];
    if (n !== null && (!Number.isInteger(n) || n < 0 || n > LIMITS.size)) errors.push(`${name}: «${title}» — целое число от 0 до ${LIMITS.size} или пусто.`);
  }
  const sum = LIMIT_GROUPS.reduce((total, { group }) => total + (limits[group] ?? 0), 0);
  if (sum > size) errors.push(`${name}: лимиты по ролям в сумме (${sum}) больше мест в составе (${size}).`);
  return errors;
}

/**
 * Проверка формата значений. Возвращает список ошибок по-русски (пустой — всё в порядке).
 * Существуют ли каналы и роли на сервере, проверяет админка — у неё есть доступ к Discord.
 */
export function validateSettings(s: BotSettings): string[] {
  const errors: string[] = [];
  const texts: [string, string, number][] = [
    ['Текст приветствия', s.welcome.text, LIMITS.text],
    ['Предложение роли', s.welcome.guestOffer, LIMITS.text],
    ['Текст кнопки роли', s.welcome.guestButton, LIMITS.button],
    ['Текст кнопки правил', s.welcome.rulesButton, LIMITS.button],
    ['Текст прощания', s.farewell.text, LIMITS.text],
    ['Приветствие в личку', s.welcomeDm.text, LIMITS.text],
    ['Анкета: строка в приветствии', s.onboarding.offer, LIMITS.text],
    ['Анкета: подпись кнопки', s.onboarding.button, LIMITS.button],
  ];
  for (const [name, value, max] of texts) {
    if (!value.trim()) errors.push(`${name}: не может быть пустым.`);
    else if (value.length > max) errors.push(`${name}: не длиннее ${max} символов.`);
  }

  if (!Number.isInteger(s.raids.defaultSize) || s.raids.defaultSize < 1 || s.raids.defaultSize > LIMITS.size) {
    errors.push(`Размер состава: целое число от 1 до ${LIMITS.size}.`);
  }
  if (!parseTime(s.raids.defaultTime)) errors.push('Время рейда по умолчанию: формат ЧЧ:ММ, например 20:00.');

  const ranges: [string, number, number][] = [
    ['Сбор перед рейдом (минут)', s.raids.gatherMinutes, LIMITS.gather],
    ['Проверка посещаемости (минут)', s.raids.attendanceMinutes, LIMITS.attendance],
    ['Поздняя отписка (часов)', s.alerts.lateCancelHours, LIMITS.lateHours],
  ];
  if (!Number.isInteger(s.raids.tempRoleHours) || s.raids.tempRoleHours < 1 || s.raids.tempRoleHours > LIMITS.tempRoleHours) {
    errors.push(`Временная роль: снимать через 1–${LIMITS.tempRoleHours} часов после начала.`);
  }
  const archive = s.raids.archive;
  if (!ARCHIVE_MODES.includes(archive.mode)) errors.push('Архив рег: неизвестный режим.');
  if (archive.mode !== 'off' && (!Number.isInteger(archive.hours) || archive.hours < 1 || archive.hours > LIMITS.archiveHours)) {
    errors.push(`Архив рег: через 1–${LIMITS.archiveHours} часов после начала.`);
  }
  if (archive.mode === 'move' && !archive.channelId) errors.push('Архив рег: для переноса выбери канал-архив.');
  for (const [name, value, max] of ranges) {
    if (!Number.isInteger(value) || value < 0 || value > max) errors.push(`${name}: целое число от 0 до ${max}.`);
  }

  const sveta = s.sveta;
  if (sveta.channelIds.length > LIMITS.svetaChannels) errors.push(`Света: не больше ${LIMITS.svetaChannels} каналов.`);
  if (sveta.enabled && !sveta.channelIds.length) errors.push('Света: выбери хотя бы один канал, где она живёт.');
  if (!sveta.persona.trim()) errors.push('Света: характер не может быть пустым.');
  else if (sveta.persona.length > LIMITS.persona) errors.push(`Света: характер не длиннее ${LIMITS.persona} символов.`);
  // Gemini: gemini-flash-latest; OpenRouter: vendor/model[:free], например minimax/minimax-m3.1-flash:free.
  const modelId = /^[a-z0-9][a-z0-9._:/-]{2,100}$/;
  if (!modelId.test(sveta.model)) {
    errors.push('Света: основная модель — латиница, цифры, точки, дефисы, «/» и «:», например gemini-flash-latest или minimax/minimax-m3.1-flash:free.');
  }
  if (sveta.fallbackModel && !modelId.test(sveta.fallbackModel)) errors.push('Света: запасная модель — в том же виде, что и основная, или пусто.');
  const svetaRanges: [string, number, number, number][] = [
    ['Света: шанс встрять самой (%)', sveta.randomPercent, 0, LIMITS.randomPercent],
    ['Света: пауза для одного человека (секунд)', sveta.userCooldownSeconds, 0, LIMITS.svetaCooldown],
    ['Света: ответов в час', sveta.perHour, 1, LIMITS.svetaPerHour],
    ['Света: ответов в день', sveta.perDay, 1, LIMITS.svetaPerDay],
  ];
  for (const [name, value, min, max] of svetaRanges) {
    if (!Number.isInteger(value) || value < min || value > max) errors.push(`${name}: целое число от ${min} до ${max}.`);
  }
  if (sveta.lore.length > LIMITS.lore) errors.push(`Света: историй — не больше ${LIMITS.lore}.`);
  sveta.lore.forEach((entry, index) => {
    const name = `Света: история ${index + 1}${entry.names[0] ? ` («${entry.names[0]}»)` : ''}`;
    if (!entry.names.length) errors.push(`${name}: укажи, о ком она (имя или ник).`);
    if (entry.names.length > LIMITS.loreNames) errors.push(`${name}: не больше ${LIMITS.loreNames} имён.`);
    if (entry.names.some((n) => n.length < 2 || n.length > LIMITS.loreName)) errors.push(`${name}: имя — от 2 до ${LIMITS.loreName} символов.`);
    if (!entry.story.trim()) errors.push(`${name}: текст истории не может быть пустым.`);
    else if (entry.story.length > LIMITS.loreStory) errors.push(`${name}: не длиннее ${LIMITS.loreStory} символов.`);
  });

  const profanity = s.profanity;
  if (!PROFANITY_LEVELS.includes(profanity.level)) errors.push('Фильтр мата: неизвестный уровень — «только мат» или «мат и грубые слова».');
  if (!PROFANITY_ACTIONS.includes(profanity.action)) errors.push('Фильтр мата: неизвестное действие с нарушителем.');
  const profanityRanges: [string, number, number, number][] = [
    ['Фильтр мата: нарушений до мута', profanity.strikesToMute, 1, LIMITS.strikes],
    ['Фильтр мата: окно нарушений (минут)', profanity.strikeWindowMinutes, 1, LIMITS.strikeWindow],
    ['Фильтр мата: мут (минут)', profanity.muteMinutes, 1, LIMITS.muteMinutes],
    ['Фильтр мата: предупреждение (секунд)', profanity.warningSeconds, 0, LIMITS.warningSeconds],
  ];
  for (const [name, value, min, max] of profanityRanges) {
    if (!Number.isInteger(value) || value < min || value > max) errors.push(`${name}: целое число от ${min} до ${max}.`);
  }
  if (profanity.ignoredChannelIds.length > LIMITS.profanityChannels) errors.push(`Фильтр мата: каналов-исключений не больше ${LIMITS.profanityChannels}.`);
  if (profanity.extraWords.length > LIMITS.profanityWords) errors.push(`Фильтр мата: своих слов не больше ${LIMITS.profanityWords}.`);
  const badWord = profanity.extraWords.find((word) => word.length < 2 || word.length > LIMITS.profanityWord || /\s/.test(word));
  if (badWord !== undefined) errors.push(`Фильтр мата: «${badWord}» — слово от 2 до ${LIMITS.profanityWord} символов без пробелов.`);

  if (!Number.isInteger(s.sticky.intervalSeconds) || s.sticky.intervalSeconds < LIMITS.stickyMin || s.sticky.intervalSeconds > LIMITS.stickyMax) {
    errors.push(`Липкие сообщения: переставлять не чаще раза в ${LIMITS.stickyMin}–${LIMITS.stickyMax} секунд.`);
  }
  s.sticky.items.forEach((item, index) => {
    if (!item.channelId) errors.push(`Липкое сообщение ${index + 1}: выбери канал.`);
    if (!item.text.trim()) errors.push(`Липкое сообщение ${index + 1}: текст не может быть пустым.`);
    else if (item.text.length > LIMITS.stickyText) errors.push(`Липкое сообщение ${index + 1}: не длиннее ${LIMITS.stickyText} символов.`);
    if (item.roleIds.length > LIMITS.stickyRoles) errors.push(`Липкое сообщение ${index + 1}: упомянуть можно не больше ${LIMITS.stickyRoles} ролей.`);
  });
  if (new Set(s.sticky.items.map((i) => i.channelId)).size !== s.sticky.items.length) {
    errors.push('Липкие сообщения: в одном канале может быть только одно.');
  }

  const templateIds = new Set<string>();
  s.raidTemplates.forEach((t, index) => {
    const name = `Шаблон ${index + 1}${t.title.trim() ? ` («${t.title.trim()}»)` : ''}`;
    if (templateIds.has(t.id)) errors.push(`${name}: повторяется внутренний id.`);
    templateIds.add(t.id);
    if (!t.title.trim()) errors.push(`${name}: название не может быть пустым.`);
    else if (t.title.length > LIMITS.title) errors.push(`${name}: название не длиннее ${LIMITS.title} символов.`);
    if (t.description.length > LIMITS.templateDescription) errors.push(`${name}: описание не длиннее ${LIMITS.templateDescription} символов.`);
    if (!Number.isInteger(t.size) || t.size < 1 || t.size > LIMITS.size) errors.push(`${name}: мест в составе — от 1 до ${LIMITS.size}.`);
    if (!parseTime(t.time)) errors.push(`${name}: время в формате ЧЧ:ММ, например 20:00.`);
    const roleLists: [string, string[]][] = [
      ['упомянуть', t.pingRoleIds],
      ['в основу', t.mainRoleIds],
      ['только в запас', t.reserveRoleIds],
    ];
    for (const [list, ids] of roleLists) {
      if (ids.length > LIMITS.templateRoles) errors.push(`${name}: «${list}» — не больше ${LIMITS.templateRoles} ролей.`);
    }
    if (t.reserveRoleIds.length && !t.mainRoleIds.length) {
      errors.push(`${name}: «только в запас» работает, когда выбрано, кто записывается в основу, — сначала выбери роли основы.`);
    }
    if (t.reserveRoleIds.some((id) => t.mainRoleIds.includes(id))) errors.push(`${name}: одна и та же роль и в основе, и только в запасе.`);
    if (!isKind(t.kind)) errors.push(`${name}: неизвестный вид сбора.`);
    errors.push(...limitErrors(name, t.limits, t.size));
    if (t.slots.length > LIMITS.slots) errors.push(`${name}: в расписании не больше ${LIMITS.slots} строк.`);
    const isDay = (day: number) => Number.isInteger(day) && day >= 1 && day <= 7;
    t.slots.forEach((slot, i) => {
      const row = `${name}, расписание, строка ${i + 1}`;
      if (!isDay(slot.raidDay) || !isDay(slot.openDay)) errors.push(`${row}: выбери дни рейда и открытия реги.`);
      if (!parseTime(slot.raidTime)) errors.push(`${row}: время рейда в формате ЧЧ:ММ.`);
      if (!parseTime(slot.openTime)) errors.push(`${row}: время открытия реги в формате ЧЧ:ММ.`);
    });
    // По дню рейда бот понимает, что рега уже открыта, — два рейда одного шаблона в один день он бы не различил.
    if (new Set(t.slots.map((slot) => slot.raidDay)).size !== t.slots.length) errors.push(`${name}: в один день — только один рейд этого шаблона.`);
  });
  if (s.raidTemplates.length > LIMITS.templates) errors.push(`Шаблонов рейдов — не больше ${LIMITS.templates}.`);

  for (const kind of PLAYER_GROUP_KINDS) {
    const group = s.groups[kind];
    const name = `Группы игроков (${KINDS[kind].title})`;
    if (!Number.isInteger(group.size) || group.size < 1 || group.size > LIMITS.size) errors.push(`${name}: мест — от 1 до ${LIMITS.size}.`);
    errors.push(...limitErrors(name, group.limits, group.size));
    if (group.creatorRoleIds.length > LIMITS.templateRoles) errors.push(`${name}: ролей — не больше ${LIMITS.templateRoles}.`);
  }

  s.autoClean.forEach((rule, index) => {
    const name = `Автоочистка ${index + 1}`;
    if (!rule.channelId) errors.push(`${name}: выбери канал.`);
    if (!Number.isInteger(rule.hours) || rule.hours < 1 || rule.hours > LIMITS.autoCleanHours) {
      errors.push(`${name}: срок — целое число часов от 1 до ${LIMITS.autoCleanHours}.`);
    }
  });
  if (new Set(s.autoClean.map((rule) => rule.channelId)).size !== s.autoClean.length) errors.push('Автоочистка: у канала может быть только одно правило.');
  if (s.autoClean.length > LIMITS.autoCleanChannels) errors.push(`Автоочистка: не больше ${LIMITS.autoCleanChannels} каналов.`);

  s.voiceRoles.forEach((link, index) => {
    if (!link.channelId || !link.roleId) errors.push(`Голосовая роль ${index + 1}: нужны и голосовой канал, и роль.`);
  });

  return errors;
}
