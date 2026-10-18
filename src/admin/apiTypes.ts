// Типы JSON API админки — общие для сервера (src/admin/api.ts) и интерфейса (admin-ui).
// Файл самодостаточный (без импортов): интерфейс собирается отдельно и не должен тянуть код бота.
// Совпадение с настоящими типами бота проверяет компилятор в api.ts (присваивания с аннотациями этих типов).

/** Вариант в выпадающем списке канала или роли. */
export interface Option {
  id: string;
  name: string;
  /** Подзаголовок группы (категория канала). */
  group?: string;
  /** Предупреждение рядом с выбором (например, роль выше роли бота). */
  warning?: string;
  /** Цвет роли (#rrggbb), если он задан. */
  color?: string;
}

export interface ApiError {
  /** Тексты ошибок по-русски — показываются как есть. */
  errors: string[];
}

/** Ответ на действие без данных: текст для уведомления. */
export interface ApiMessage {
  message: string;
}

// --- Настройки (повторяют BotSettings из src/botSettings.ts) ---

export const LOG_CATEGORY_IDS = ['members', 'server', 'messages', 'voice', 'moderation', 'raids'] as const;
export type LogCategory = (typeof LOG_CATEGORY_IDS)[number];
export type ArchiveMode = 'off' | 'move' | 'delete';

export interface RaidSchedule {
  id: string;
  title: string;
  channelId: string | null;
  /** 1 — понедельник … 7 — воскресенье. */
  days: number[];
  openAt: string;
  raidDayOffset: number;
  raidTime: string;
  pingRoleId: string | null;
}

export interface RaidTemplate {
  id: string;
  title: string;
  description: string;
  size: number;
  time: string;
  channelId: string | null;
  pingRoleId: string | null;
}

export interface Settings {
  channels: { welcome: string | null; rules: string | null; auth: string | null };
  roles: { guest: string | null; autorole: string | null };
  welcome: { text: string; guestOffer: string; guestButton: string; rulesButton: string };
  raids: {
    defaultSize: number;
    defaultTime: string;
    gatherMinutes: number;
    attendanceMinutes: number;
    attendanceVoiceChannelId: string | null;
    tempRoleId: string | null;
    tempRoleHours: number;
    archive: { mode: ArchiveMode; channelId: string | null; hours: number };
    boardChannelId: string | null;
    discordEvents: boolean;
    schedules: RaidSchedule[];
  };
  logs: Record<LogCategory, { channelId: string | null; enabled: boolean }>;
  voiceRoles: { channelId: string; roleId: string }[];
  /** roleIds — роли, которые упоминаются в начале липкого сообщения. */
  sticky: { intervalSeconds: number; items: { channelId: string; text: string; roleIds: string[] }[] };
  raidTemplates: RaidTemplate[];
  autoClean: { channelId: string; hours: number; keepBot: boolean }[];
  farewell: { channelId: string | null; text: string };
  welcomeDm: { enabled: boolean; text: string };
  /** Анкета новичков: опрос в приветствии, роль и карточка офицерам после заполнения. */
  onboarding: { pollId: number | null; offer: string; button: string; roleId: string | null; removeRoleId: string | null; notify: boolean };
  alerts: { channelId: string | null; roleId: string | null; lateCancelHours: number; incidentChannelId: string | null };
}

/** Разделы настроек для PUT /api/settings/:section и что в каждом сохраняется. */
export interface SettingsSections {
  channels: Pick<Settings, 'channels' | 'roles' | 'voiceRoles'>;
  logs: Pick<Settings, 'logs'>;
  alerts: { alerts: Settings['alerts']; raids: Pick<Settings['raids'], 'gatherMinutes' | 'attendanceMinutes' | 'attendanceVoiceChannelId'> };
  welcome: Pick<Settings, 'welcome'>;
  welcomeDm: Pick<Settings, 'welcomeDm'>;
  farewell: Pick<Settings, 'farewell'>;
  onboarding: Pick<Settings, 'onboarding'>;
  raids: { raids: Omit<Settings['raids'], 'gatherMinutes' | 'attendanceMinutes' | 'attendanceVoiceChannelId'> };
  templates: Pick<Settings, 'raidTemplates'>;
  sticky: Pick<Settings, 'sticky'>;
  autoclean: Pick<Settings, 'autoClean'>;
}
export type SettingsSection = keyof SettingsSections;

// --- Ответы API ---

export interface MeResponse {
  user: { id: string; name: string; avatar: string | null };
  guild: { id: string; name: string; iconUrl: string | null };
  /** Передаётся в заголовке X-CSRF-Token во всех изменяющих запросах. */
  csrf: string;
}

export interface OverviewResponse {
  bot: string;
  guild: string;
  members: number;
  ping: number;
  openRaids: number;
  polls: number;
  avatarUrl: string;
  bannerUrl: string | null;
}

export interface OptionsResponse {
  textChannels: Option[];
  voiceChannels: Option[];
  /** Роли, которые бот выдаёт: с предупреждением, если роль выше роли бота. */
  roles: Option[];
  /** Роли для упоминания: высота неважна. */
  mentionRoles: Option[];
}

// --- Опросы (повторяют PollDefinition и PollStats из src/polls) ---

export type QuestionKind = 'single' | 'multiple' | 'short' | 'paragraph';

export interface PollDefinition {
  title: string;
  description: string;
  image?: string;
  anonymous: boolean;
  button: string;
  minutes?: number;
  mentionRoleId?: string;
  blocks: {
    title: string;
    intro?: string;
    conditions: { questionId: string; optionValue: string; negate: boolean }[];
    questions: { id: string; title: string; hint?: string; required: boolean; kind: QuestionKind; options: { value: string; label: string; description?: string }[] }[];
  }[];
}

export interface PollStats {
  total: number;
  completed: number;
  questions: {
    block: string;
    title: string;
    kind: QuestionKind;
    required: boolean;
    answered: number;
    options: { label: string; count: number; percent: number }[];
    texts: { userId: string | null; text: string }[];
  }[];
}

export interface PollRow {
  id: number;
  title: string;
  channel: string;
  closed: boolean;
  total: number;
  completed: number;
  createdAt: number;
  url: string | null;
  /** Этот опрос сейчас — анкета новичков. */
  onboarding: boolean;
}

export interface PollCheckResponse {
  /** Ошибки в тексте («Строка N: …»); пусто — текст верный. */
  errors: string[];
  preview: PollDefinition | null;
  /** Примерно минут на прохождение и сколько вопросов — для предпросмотра. */
  minutes: number | null;
  questions: number | null;
}

export interface PollSourceResponse {
  source: string;
  channelId: string | null;
  roleId: string | null;
}

export interface PollRespondent {
  name: string;
  completed: boolean;
  updatedAt: number;
  answers: { block: string; question: string; answer: string }[];
}

export interface PollResultsResponse {
  info: { id: number; title: string; channel: string; url: string | null; closed: boolean; anonymous: boolean; canCopy: boolean; onboarding: boolean };
  stats: PollStats;
  /** Имена авторов текстовых ответов и ответивших (в анонимном опросе — пусто). */
  names: Record<string, string>;
  /** Ответы по людям; null — опрос анонимный. */
  respondents: PollRespondent[] | null;
}

// --- Посещаемость и шаблоны ---

export interface AttendanceRow {
  userId: string;
  name: string;
  present: number;
  tentativePresent: number;
  absent: number;
  tentativeAbsent: number;
  walkin: number;
  rate: number | null;
}

export interface AttendanceResponse {
  from: string;
  to: string;
  checked: number;
  rows: AttendanceRow[];
}

export interface TemplateCreateResponse extends ApiMessage {
  url: string;
}
