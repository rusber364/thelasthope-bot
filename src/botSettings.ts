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

export interface Onboarding {
  /** Опрос-анкета (открытый опрос этого сервера); null — анкету не предлагать. */
  pollId: number | null;
  /** Строка в приветствии над кнопкой. Подстановки как у приветствия: {user} {server} {rules} {role}. */
  offer: string;
  /** Подпись кнопки. */
  button: string;
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
  /** С какими ролями записываются в основу (пусто — все). */
  mainRoleIds: string[];
  /** С какими ролями записываются только в запас (имеет смысл, только если основа ограничена). */
  reserveRoleIds: string[];
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
  /** Прощание при выходе участника. Подстановки: {user} {name} {server} {members}. */
  farewell: { channelId: string | null; text: string };
  /** Приветствие в личку новичку. Подстановки: {user} {name} {server} {rules} {welcome} {role}. */
  welcomeDm: { enabled: boolean; text: string };
  /** Анкета новичков: опрос, который предлагается в приветствии, и что сделать, когда его заполнили. */
  onboarding: Onboarding;
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

export const LIMITS = { text: 2000, button: 80, title: 100, size: 100, gather: 120, attendance: 180, lateHours: 72, tempRoleHours: 48, archiveHours: 72, stickyMin: 5, stickyMax: 600, stickyText: 1800, stickyRoles: 5, templates: 25, templateDescription: 1000, slots: 14, templateRoles: 10, autoCleanHours: 720, autoCleanChannels: 20 };

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
    voiceRoles: [],
    sticky: { intervalSeconds: 15, items: [] },
    raidTemplates: [defaultGroup('group1', 'Рейд — группа 1', env(config.raidChannel1Id)), defaultGroup('group2', 'Рейд — группа 2', env(config.raidChannel2Id))],
    autoClean: [],
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
      roleId: null,
      removeRoleId: null,
      notify: true,
    },
  };
}

/** Группа по умолчанию: рейды в чт, пт и пн в 20:00, рега открывается в тот же день в 00:00. */
function defaultGroup(id: string, title: string, channelId: string | null): RaidTemplate {
  const slots = [4, 5, 1].map((day) => ({ raidDay: day, raidTime: '20:00', openDay: day, openTime: '00:00' }));
  return { id, title, description: '', size: 40, time: '20:00', channelId, pingRoleIds: [], mainRoleIds: [], reserveRoleIds: [], slots };
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
    mainRoleIds: template.mainRoleIds ?? [],
    reserveRoleIds: template.reserveRoleIds ?? [],
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
