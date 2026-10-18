// Общие помощники админки: варианты для выпадающих списков и проверка того, что выбранные каналы и роли
// действительно есть на сервере. Ими пользуется JSON API админки (api.ts).
import { ChannelType, type Guild } from 'discord.js';
import { getPoll, type StoredPoll } from '../polls/store.ts';
import type { Option } from './apiTypes.ts';

const TEXT_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);
const VOICE_TYPES = new Set([ChannelType.GuildVoice, ChannelType.GuildStageVoice]);

export function textChannels(guild: Guild): Option[] {
  return guild.channels.cache
    .filter((channel) => TEXT_TYPES.has(channel.type))
    .sort((a, b) => ('rawPosition' in a && 'rawPosition' in b ? a.rawPosition - b.rawPosition : 0))
    .sort((a, b) => (a.parent?.rawPosition ?? -1) - (b.parent?.rawPosition ?? -1))
    .map((channel) => ({ id: channel.id, name: `#${channel.name}`, ...(channel.parent ? { group: channel.parent.name } : {}) }));
}

export function voiceChannels(guild: Guild): Option[] {
  return guild.channels.cache
    .filter((channel) => VOICE_TYPES.has(channel.type))
    .sort((a, b) => ('rawPosition' in a && 'rawPosition' in b ? a.rawPosition - b.rawPosition : 0))
    .map((channel) => ({ id: channel.id, name: `🔊 ${channel.name}`, ...(channel.parent ? { group: channel.parent.name } : {}) }));
}

export function roleOptions(guild: Guild): Option[] {
  return guild.roles.cache
    .filter((role) => role.id !== guild.id && !role.managed)
    .sort((a, b) => b.position - a.position)
    .map((role) => ({
      id: role.id,
      name: role.name,
      ...(role.color ? { color: role.hexColor } : {}),
      ...(role.editable ? {} : { warning: 'Роль стоит выше роли бота — бот не сможет её выдать. Подними роль бота в настройках сервера.' }),
    }));
}

/** Роли для упоминания: высота роли не важна, поэтому без предупреждений «выше роли бота». */
export function mentionRoles(guild: Guild): Option[] {
  return roleOptions(guild).map(({ warning: _, ...option }) => option);
}

/** Текстовый канал этого сервера или null (пусто — не выбран, чужой — ошибка в errors). */
export function checkChannel(guild: Guild, id: string | null | undefined, name: string, errors: string[]): string | null {
  if (!id) return null;
  const channel = guild.channels.cache.get(id);
  if (!channel || !TEXT_TYPES.has(channel.type)) {
    errors.push(`${name}: такого текстового канала нет на сервере.`);
    return null;
  }
  return id;
}

export function checkVoiceChannel(guild: Guild, id: string | null | undefined, name: string, errors: string[]): string | null {
  if (!id) return null;
  const channel = guild.channels.cache.get(id);
  if (!channel || !VOICE_TYPES.has(channel.type)) {
    errors.push(`${name}: такого голосового канала нет на сервере.`);
    return null;
  }
  return id;
}

export function checkRole(guild: Guild, id: string | null | undefined, name: string, errors: string[]): string | null {
  if (!id) return null;
  const role = guild.roles.cache.get(id);
  if (!role || role.id === guild.id || role.managed) {
    errors.push(`${name}: такой роли нет на сервере.`);
    return null;
  }
  return id;
}

/** Опрос этого сервера по id из адреса; чужие и несуществующие — null. */
export function guildPoll(guild: Guild, id: string | undefined): StoredPoll | null {
  const poll = id && /^\d+$/.test(id) ? getPoll(Number(id)) : null;
  return poll?.guildId === guild.id ? poll : null;
}

export function channelName(guild: Guild, channelId: string): string {
  const channel = guild.channels.cache.get(channelId);
  return channel ? `#${channel.name}` : 'канал удалён';
}

export function messageUrl(poll: StoredPoll): string | null {
  return poll.messageId ? `https://discord.com/channels/${poll.guildId}/${poll.channelId}/${poll.messageId}` : null;
}
