// Голосовые роли (как в Carl-bot Premium): вход в связанный голосовой канал выдаёт роль, выход — снимает.
// Например, открыть текстовый канал рейда только тем, кто сейчас в голосовом рейда.
// Роль из связки считается «голосовой»: при сверке её снимают у всех, кого нет в нужном канале.
import { Events, type Client, type Guild } from 'discord.js';
import { getSettings, type VoiceRoleLink } from '../botSettings.ts';

/** Какие роли выдать и снять при переходе из канала before в канал after. */
export function voiceRoleDiff(links: VoiceRoleLink[], before: string | null, after: string | null): { add: string[]; remove: string[] } {
  const rolesFor = (channelId: string | null) => new Set(links.filter((l) => channelId && l.channelId === channelId).map((l) => l.roleId));
  const was = rolesFor(before);
  const now = rolesFor(after);
  return { add: [...now].filter((r) => !was.has(r)), remove: [...was].filter((r) => !now.has(r)) };
}

export interface VoiceMember {
  id: string;
  channelId: string | null;
  roleIds: Set<string>;
}

/** Сверка всех участников с текущими голосовыми каналами: кому выдать и у кого снять голосовые роли. */
export function voiceRoleSync(links: VoiceRoleLink[], members: VoiceMember[]): { add: [string, string][]; remove: [string, string][] } {
  const linkedRoles = new Set(links.map((l) => l.roleId));
  const add: [string, string][] = [];
  const remove: [string, string][] = [];
  for (const member of members) {
    const should = new Set(links.filter((l) => member.channelId && l.channelId === member.channelId).map((l) => l.roleId));
    for (const roleId of linkedRoles) {
      const has = member.roleIds.has(roleId);
      if (should.has(roleId) && !has) add.push([member.id, roleId]);
      if (!should.has(roleId) && has) remove.push([member.id, roleId]);
    }
  }
  return { add, remove };
}

function editableRole(guild: Guild, roleId: string) {
  const role = guild.roles.cache.get(roleId);
  return role?.editable ? role : null;
}

/** Привести голосовые роли на сервере в соответствие с тем, кто сейчас в голосовых каналах. */
export async function syncVoiceRoles(guild: Guild): Promise<void> {
  const links = getSettings().voiceRoles;
  if (!links.length) return;
  const members: VoiceMember[] = guild.members.cache
    .filter((m) => !m.user.bot)
    .map((m) => ({ id: m.id, channelId: guild.voiceStates.cache.get(m.id)?.channelId ?? null, roleIds: new Set(m.roles.cache.keys()) }));
  const { add, remove } = voiceRoleSync(links, members);
  for (const [userId, roleId] of add) {
    const role = editableRole(guild, roleId);
    if (role) await guild.members.cache.get(userId)?.roles.add(role, 'Голосовая роль: в канале').catch(() => {});
  }
  for (const [userId, roleId] of remove) {
    const role = editableRole(guild, roleId);
    if (role) await guild.members.cache.get(userId)?.roles.remove(role, 'Голосовая роль: не в канале').catch(() => {});
  }
}

export function registerVoiceRoles(client: Client): void {
  client.on(Events.VoiceStateUpdate, async (before, after) => {
    const member = after.member ?? before.member;
    if (!member || member.user.bot || before.channelId === after.channelId) return;
    const { add, remove } = voiceRoleDiff(getSettings().voiceRoles, before.channelId, after.channelId);
    for (const roleId of remove) {
      const role = editableRole(after.guild, roleId);
      if (role && member.roles.cache.has(roleId)) await member.roles.remove(role, 'Голосовая роль: выход из канала').catch(() => {});
    }
    for (const roleId of add) {
      const role = editableRole(after.guild, roleId);
      if (role && !member.roles.cache.has(roleId)) await member.roles.add(role, 'Голосовая роль: вход в канал').catch(() => {});
    }
  });
}
