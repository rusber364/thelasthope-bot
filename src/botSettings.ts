// Настройки, которые меняются из админки: каналы, роли, тексты приветствия, расписание рег, лог-каналы.
// Хранятся в базе одним JSON (таблица settings, ключ "bot"). Читай их через getSettings()
// в момент использования — тогда изменения из админки действуют сразу, без перезапуска.
//
// Откуда берутся значения: умолчания ниже ← ID из .env (как было до админки) ← сохранённое в базе.
import { config } from './config.ts';
import { db } from './db.ts';
import { parseTime } from './lib/time.ts';

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

/** Липкое сообщение в канале. roleIds — кого упомянуть в начале сообщения. */
export interface StickyItem {
  channelId: string;
  text: string;
  roleIds: string[];
}

export interface RaidSchedule {
  /** Не меняется после создания: по нему бот понимает, что рега на этот день уже открыта. */
  id: string;
  title: string;
  channelId: string | null;
  /** 1 — понедельник … 7 — воскресенье. */
  days: number[];
  openAt: string;
  /** 0 — рейд в тот же день, что и открытие реги; 7 — через неделю. */
  raidDayOffset: number;
  raidTime: string;
  /** Роль, которую бот упоминает, когда открывает эту регу (null — без упоминания). */
  pingRoleId: string | null;
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

/** Шаблон реги: заготовка для создания в два клика из админки. */
export interface RaidTemplate {
  /** Не меняется после создания — по нему находят шаблон при создании реги. */
  id: string;
  title: string;
  description: string;
  size: number;
  /** Время начала ЧЧ:ММ. */
  time: string;
  channelId: string | null;
  pingRoleId: string | null;
}

export interface BotSettings {
  channels: { welcome: string | null; rules: string | null; auth: string | null };
  roles: { guest: string | null; autorole: string | null };
  welcome: {
    /** Подстановки: {user} {server} {rules} {auth} {role}. */
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
    schedules: RaidSchedule[];
  };
  logs: Record<LogCategory, { channelId: string | null; enabled: boolean }>;
  /** Связки «голосовой канал → роль». */
  voiceRoles: VoiceRoleLink[];
  /** Липкие сообщения: текст, который бот держит последним в канале. */
  sticky: { intervalSeconds: number; items: StickyItem[] };
  /** Шаблоны рег (страница «Шаблоны рег» в админке). */
  raidTemplates: RaidTemplate[];
  /** Автоочистка каналов. */
  autoClean: AutoCleanRule[];
  /** Прощание при выходе участника. Подстановки: {user} {name} {server} {members}. */
  farewell: { channelId: string | null; text: string };
  /** Приветствие в личку новичку. Подстановки: {user} {name} {server} {rules} {auth} {welcome} {role}. */
  welcomeDm: { enabled: boolean; text: string };
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

export const LIMITS = { text: 2000, button: 80, title: 100, size: 100, dayOffset: 14, gather: 120, attendance: 180, lateHours: 72, tempRoleHours: 48, archiveHours: 72, stickyMin: 5, stickyMax: 600, stickyText: 1800, stickyRoles: 5, templates: 25, templateDescription: 1000, autoCleanHours: 720, autoCleanChannels: 20 };

function defaults(): BotSettings {
  const env = (value: string | undefined) => value ?? null;
  return {
    channels: { welcome: env(config.welcomeChannelId), rules: env(config.rulesChannelId), auth: env(config.authChannelId) },
    roles: { guest: env(config.guestRoleId), autorole: env(config.autoroleId) },
    welcome: {
      text:
        '{user}, добро пожаловать в **{server}**! Ознакомься с {rules} и пройди {auth}. ' +
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
      schedules: [
        { id: 'group1', title: 'Рейд — группа 1', channelId: env(config.raidChannel1Id), days: [4, 5, 1], openAt: '00:00', raidDayOffset: 0, raidTime: '20:00', pingRoleId: null },
        { id: 'group2', title: 'Рейд — группа 2', channelId: env(config.raidChannel2Id), days: [4, 5, 1], openAt: '00:00', raidDayOffset: 0, raidTime: '20:00', pingRoleId: null },
      ],
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
    voiceRoles: [],
    sticky: { intervalSeconds: 15, items: [] },
    raidTemplates: [],
    autoClean: [],
    farewell: { channelId: null, text: '**{name}** покидает {server}. Удачи в Азероте! 👋 Нас теперь {members}.' },
    welcomeDm: {
      enabled: false,
      text:
        'Привет, {name}! 👋 Добро пожаловать в **{server}** — гильдию Альянса в Warcraft Forever.\n\n' +
        'Что сделать первым делом:\n1. Прочитай {rules}.\n2. Пройди {auth}.\n3. Возьми роль «{role}» кнопкой в {welcome}.\n\n' +
        'Есть вопросы — пиши офицерам. До встречи в Азероте! ⚔️',
    },
  };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

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
  const merged = merge(defaults(), saved);
  // Массивы из базы заменяют умолчания целиком — дополняем расписания полями, которых не было в старых версиях.
  merged.raids.schedules = merged.raids.schedules.map((schedule) => ({ ...schedule, pingRoleId: schedule.pingRoleId ?? null }));
  merged.sticky.items = merged.sticky.items.map((item) => ({ ...item, roleIds: item.roleIds ?? [] }));
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

  s.raidTemplates.forEach((t, index) => {
    const name = `Шаблон ${index + 1}`;
    if (!t.title.trim()) errors.push(`${name}: название не может быть пустым.`);
    else if (t.title.length > LIMITS.title) errors.push(`${name}: название не длиннее ${LIMITS.title} символов.`);
    if (t.description.length > LIMITS.templateDescription) errors.push(`${name}: описание не длиннее ${LIMITS.templateDescription} символов.`);
    if (!Number.isInteger(t.size) || t.size < 1 || t.size > LIMITS.size) errors.push(`${name}: мест в составе — от 1 до ${LIMITS.size}.`);
    if (!parseTime(t.time)) errors.push(`${name}: время в формате ЧЧ:ММ, например 20:00.`);
    if (!t.channelId) errors.push(`${name}: выбери канал.`);
  });
  if (s.raidTemplates.length > LIMITS.templates) errors.push(`Шаблонов рег — не больше ${LIMITS.templates}.`);

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

  const ids = new Set<string>();
  s.raids.schedules.forEach((schedule, index) => {
    const name = `Расписание ${index + 1}${schedule.title ? ` («${schedule.title}»)` : ''}`;
    if (ids.has(schedule.id)) errors.push(`${name}: повторяется внутренний id.`);
    ids.add(schedule.id);
    if (!schedule.title.trim() || schedule.title.length > LIMITS.title) errors.push(`${name}: название от 1 до ${LIMITS.title} символов.`);
    if (!schedule.days.length || schedule.days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
      errors.push(`${name}: выбери хотя бы один день недели.`);
    }
    if (!parseTime(schedule.openAt)) errors.push(`${name}: время открытия в формате ЧЧ:ММ.`);
    if (!parseTime(schedule.raidTime)) errors.push(`${name}: время рейда в формате ЧЧ:ММ.`);
    if (!Number.isInteger(schedule.raidDayOffset) || schedule.raidDayOffset < 0 || schedule.raidDayOffset > LIMITS.dayOffset) {
      errors.push(`${name}: сдвиг дня рейда от 0 до ${LIMITS.dayOffset}.`);
    }
  });
  return errors;
}
