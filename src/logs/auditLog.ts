// Журнал аудита Discord: в отличие от обычных событий, он говорит, КТО сделал действие.
// Изменения каналов, ролей, ников, настроек сервера → «лог-сервер»;
// ручные кики, баны, тайм-ауты и действия в голосовых → «лог-модерация».
// Действия самого бота пропускаем: команды бота пишут в лог сами, а выдача ролей с кнопок — шум.
import { AuditLogEvent, EmbedBuilder, Events, TimestampStyles, time, type Client } from 'discord.js';
import type { LogCategory } from '../botSettings.ts';
import { LOG_COLORS, sendLog } from './send.ts';

/** То, что нужно от записи аудита (совместимо с GuildAuditLogsEntry из discord.js и с тестовыми данными). */
export interface AuditEntryLike {
  action: AuditLogEvent;
  executorId: string | null;
  targetId: string | null;
  reason: string | null;
  changes: readonly { key: string; old?: unknown; new?: unknown }[];
  extra?: unknown;
}

const KEY_LABELS: Record<string, string> = {
  name: 'Название',
  topic: 'Тема',
  nsfw: '18+',
  rate_limit_per_user: 'Медленный режим',
  bitrate: 'Битрейт',
  user_limit: 'Лимит участников',
  position: 'Позиция',
  parent_id: 'Категория',
  color: 'Цвет',
  hoist: 'Показывать отдельно',
  mentionable: 'Можно упоминать',
  permissions: 'Права',
  allow: 'Разрешено',
  deny: 'Запрещено',
  nick: 'Ник',
  mute: 'Мут в голосе',
  deaf: 'Звук отключён',
  code: 'Код',
  max_uses: 'Макс. использований',
  max_age: 'Срок действия',
  channel_id: 'Канал',
  icon_hash: 'Иконка',
  avatar_hash: 'Аватар',
  banner_hash: 'Баннер',
  description: 'Описание',
  verification_level: 'Уровень проверки',
  default_message_notifications: 'Уведомления по умолчанию',
  explicit_content_filter: 'Фильтр контента',
  afk_channel_id: 'AFK-канал',
  afk_timeout: 'AFK-таймаут',
  system_channel_id: 'Системный канал',
  rules_channel_id: 'Канал правил',
  vanity_url_code: 'Своя ссылка',
  owner_id: 'Владелец',
};

const CHANNEL_KEYS = new Set(['parent_id', 'channel_id', 'afk_channel_id', 'system_channel_id', 'rules_channel_id']);
/** Битовые маски прав нечитаемы — пишем просто «изменены». */
const OPAQUE_KEYS = new Set(['permissions', 'allow', 'deny', 'icon_hash', 'avatar_hash', 'banner_hash']);
/** Служебные поля, которые не показываем. */
const SKIP_KEYS = new Set(['id', 'type', 'permission_overwrites', 'available', 'tags', 'flags', '$add', '$remove', 'communication_disabled_until', 'inviter_id', 'uses', 'temporary']);

function formatValue(key: string, value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (CHANNEL_KEYS.has(key)) return `<#${String(value)}>`;
  if (key === 'owner_id') return `<@${String(value)}>`;
  if (key === 'color' && typeof value === 'number') return `#${value.toString(16).padStart(6, '0')}`;
  if (key === 'rate_limit_per_user' && typeof value === 'number') return `${value} сек`;
  if (typeof value === 'boolean') return value ? 'да' : 'нет';
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : JSON.stringify(value);
  return text.length > 100 ? `${text.slice(0, 100)}…` : text;
}

function describeChanges(changes: AuditEntryLike['changes'], limit = 8): string[] {
  const lines = changes
    .filter((change) => !SKIP_KEYS.has(change.key))
    .map((change) => {
      const label = KEY_LABELS[change.key] ?? change.key;
      if (OPAQUE_KEYS.has(change.key)) return `**${label}:** изменены`;
      return `**${label}:** ${formatValue(change.key, change.old)} → ${formatValue(change.key, change.new)}`;
    });
  return lines.length > limit ? [...lines.slice(0, limit), `…и ещё ${lines.length - limit}`] : lines;
}

/** Участник или роль, для которых изменили права канала. */
function overwriteTarget(extra: unknown): string | null {
  if (typeof extra !== 'object' || extra === null || !('id' in extra)) return null;
  const id = String((extra as { id: unknown }).id);
  const type = (extra as { type?: unknown }).type;
  const isRole = type === 0 || type === '0' || 'color' in extra || 'hexColor' in extra;
  return isRole ? `<@&${id}>` : `<@${id}>`;
}

function roleList(value: unknown): string {
  if (!Array.isArray(value)) return '—';
  return value.map((role: { id?: string; name?: string }) => (role.id ? `<@&${role.id}>` : (role.name ?? '?'))).join(' ');
}

interface Spec {
  category: LogCategory;
  title: string;
  color: number;
  target?: string;
  lines?: string[];
  showChanges?: boolean;
}

function specFor(entry: AuditEntryLike): Spec | null {
  const A = AuditLogEvent;
  const id = entry.targetId;
  const change = (key: string) => entry.changes.find((c) => c.key === key);
  const name = (change('name')?.new ?? change('name')?.old) as string | undefined;
  const extra = entry.extra as { channel?: { id?: string }; count?: number | string; removed?: number; days?: number } | undefined;

  switch (entry.action) {
    case A.GuildUpdate:
      return { category: 'server', title: 'Изменены настройки сервера', color: LOG_COLORS.update, showChanges: true };
    case A.ChannelCreate:
      return { category: 'server', title: 'Создан канал', color: LOG_COLORS.create, target: `<#${id}>${name ? ` (${name})` : ''}` };
    case A.ChannelUpdate:
      return { category: 'server', title: 'Изменён канал', color: LOG_COLORS.update, target: `<#${id}>`, showChanges: true };
    case A.ChannelDelete:
      return { category: 'server', title: 'Удалён канал', color: LOG_COLORS.delete, target: `#${name ?? id}` };
    case A.ChannelOverwriteCreate:
    case A.ChannelOverwriteUpdate:
    case A.ChannelOverwriteDelete: {
      const forWhom = overwriteTarget(entry.extra);
      return { category: 'server', title: 'Изменены права канала', color: LOG_COLORS.update, target: `<#${id}>${forWhom ? ` для ${forWhom}` : ''}` };
    }
    case A.MemberKick:
      return { category: 'moderation', title: 'Кик (вручную через Discord)', color: LOG_COLORS.warn, target: `<@${id}>` };
    case A.MemberPrune:
      return {
        category: 'moderation',
        title: 'Чистка неактивных участников',
        color: LOG_COLORS.warn,
        lines: [`**Удалено:** ${extra?.removed ?? '?'} · неактивны ${extra?.days ?? '?'} дн.`],
      };
    case A.MemberBanAdd:
      return { category: 'moderation', title: 'Бан (вручную через Discord)', color: LOG_COLORS.delete, target: `<@${id}>` };
    case A.MemberBanRemove:
      return { category: 'moderation', title: 'Снят бан (вручную через Discord)', color: LOG_COLORS.create, target: `<@${id}>` };
    case A.MemberUpdate: {
      const timeout = change('communication_disabled_until');
      if (timeout) {
        const until = typeof timeout.new === 'string' ? new Date(timeout.new) : null;
        return until
          ? {
              category: 'moderation',
              title: 'Тайм-аут (вручную через Discord)',
              color: LOG_COLORS.warn,
              target: `<@${id}>`,
              lines: [`**До:** ${time(until, TimestampStyles.ShortDateTime)} (${time(until, TimestampStyles.RelativeTime)})`],
            }
          : { category: 'moderation', title: 'Снят тайм-аут (вручную через Discord)', color: LOG_COLORS.create, target: `<@${id}>` };
      }
      if (change('mute') || change('deaf')) {
        return { category: 'moderation', title: 'Серверный мут в голосе', color: LOG_COLORS.warn, target: `<@${id}>`, showChanges: true };
      }
      return { category: 'server', title: change('nick') ? 'Изменён ник' : 'Изменён участник', color: LOG_COLORS.update, target: `<@${id}>`, showChanges: true };
    }
    case A.MemberRoleUpdate: {
      const lines: string[] = [];
      const added = change('$add');
      const removed = change('$remove');
      if (added) lines.push(`**Добавлены:** ${roleList(added.new)}`);
      if (removed) lines.push(`**Сняты:** ${roleList(removed.new)}`);
      return { category: 'server', title: 'Изменены роли участника', color: LOG_COLORS.update, target: `<@${id}>`, lines };
    }
    case A.MemberMove:
      return {
        category: 'moderation',
        title: 'Перемещение в голосовом канале',
        color: LOG_COLORS.update,
        lines: [`**Куда:** ${extra?.channel?.id ? `<#${extra.channel.id}>` : '?'} · участников: ${extra?.count ?? '?'}`],
      };
    case A.MemberDisconnect:
      return { category: 'moderation', title: 'Отключение от голосового канала', color: LOG_COLORS.warn, lines: [`**Участников:** ${extra?.count ?? '?'}`] };
    case A.BotAdd:
      return { category: 'server', title: 'Добавлен бот', color: LOG_COLORS.create, target: `<@${id}>` };
    case A.RoleCreate:
      return { category: 'server', title: 'Создана роль', color: LOG_COLORS.create, target: `<@&${id}>${name ? ` (${name})` : ''}` };
    case A.RoleUpdate:
      return { category: 'server', title: 'Изменена роль', color: LOG_COLORS.update, target: `<@&${id}>`, showChanges: true };
    case A.RoleDelete:
      return { category: 'server', title: 'Удалена роль', color: LOG_COLORS.delete, target: `@${name ?? id}` };
    case A.InviteCreate:
    case A.InviteDelete: {
      const code = (change('code')?.new ?? change('code')?.old) as string | undefined;
      const channel = (change('channel_id')?.new ?? change('channel_id')?.old) as string | undefined;
      return {
        category: 'server',
        title: entry.action === A.InviteCreate ? 'Создано приглашение' : 'Удалено приглашение',
        color: entry.action === A.InviteCreate ? LOG_COLORS.create : LOG_COLORS.delete,
        target: `${code ? `discord.gg/${code}` : '?'}${channel ? ` в <#${channel}>` : ''}`,
      };
    }
    case A.WebhookCreate:
      return { category: 'server', title: 'Создан вебхук', color: LOG_COLORS.create, target: name };
    case A.WebhookUpdate:
      return { category: 'server', title: 'Изменён вебхук', color: LOG_COLORS.update, target: name, showChanges: true };
    case A.WebhookDelete:
      return { category: 'server', title: 'Удалён вебхук', color: LOG_COLORS.delete, target: name };
    case A.EmojiCreate:
      return { category: 'server', title: 'Добавлен эмодзи', color: LOG_COLORS.create, target: name ? `:${name}:` : undefined };
    case A.EmojiUpdate:
      return { category: 'server', title: 'Изменён эмодзи', color: LOG_COLORS.update, showChanges: true };
    case A.EmojiDelete:
      return { category: 'server', title: 'Удалён эмодзи', color: LOG_COLORS.delete, target: name ? `:${name}:` : undefined };
    case A.MessageDelete:
      return {
        category: 'moderation',
        title: 'Удалено чужое сообщение',
        color: LOG_COLORS.delete,
        target: `сообщение <@${id}>${extra?.channel?.id ? ` в <#${extra.channel.id}>` : ''}`,
      };
    case A.MessageBulkDelete:
      return { category: 'moderation', title: 'Массовое удаление сообщений', color: LOG_COLORS.delete, target: `<#${id}> · ${extra?.count ?? '?'} шт.` };
    default:
      return null;
  }
}

/** Превращает запись аудита в запись лога. null — запись не логируем (неинтересная или сделана ботом). */
export function formatAuditEntry(entry: AuditEntryLike, botId: string): { category: LogCategory; embed: EmbedBuilder } | null {
  if (!entry.executorId || entry.executorId === botId) return null;
  const spec = specFor(entry);
  if (!spec) return null;

  const lines = [`**Кто:** <@${entry.executorId}>`];
  if (spec.target) lines.push(`**Что:** ${spec.target}`);
  if (spec.lines) lines.push(...spec.lines);
  if (spec.showChanges) lines.push(...describeChanges(entry.changes));
  if (entry.reason) lines.push(`**Причина:** ${entry.reason.slice(0, 500)}`);

  const embed = new EmbedBuilder().setColor(spec.color).setTitle(spec.title).setDescription(lines.join('\n'));
  if (entry.targetId) embed.setFooter({ text: `ID: ${entry.targetId}` });
  return { category: spec.category, embed };
}

export function registerAuditLogs(client: Client): void {
  client.on(Events.GuildAuditLogEntryCreate, async (entry, guild) => {
    const result = formatAuditEntry(entry, guild.client.user.id);
    if (result) await sendLog(guild, result.category, result.embed);
  });
}
