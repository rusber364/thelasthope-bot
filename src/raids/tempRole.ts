// Временная роль рейда: выдаётся при записи, снимается при отписке и через N часов после начала.
// Удобно, чтобы открыть записавшимся каналы рейда или упоминать только их.
// Что уже снято, отмечено в базе (role_cleaned), поэтому после перезапуска бот доделает чистку.
import type { Client, Guild, Role } from 'discord.js';
import { getSettings } from '../botSettings.ts';
import { getSignups, hasOtherActiveSignup, markRoleCleaned, raidsDueForRoleCleanup } from './store.ts';

const HOUR = 60 * 60 * 1000;
const holdMs = () => getSettings().raids.tempRoleHours * HOUR;
let warned = false;

function raidRole(guild: Guild): Role | null {
  const roleId = getSettings().raids.tempRoleId;
  if (!roleId) return null;
  const role = guild.roles.cache.get(roleId);
  if (!role) return null;
  if (!role.editable) {
    if (!warned) console.warn(`⚠️ Не могу выдавать временную роль «${role.name}»: роль бота должна быть выше неё.`);
    warned = true;
    return null;
  }
  return role;
}

export async function grantRaidRole(guild: Guild, userId: string): Promise<void> {
  const role = raidRole(guild);
  if (!role) return;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member || member.roles.cache.has(role.id)) return;
  await member.roles.add(role, 'Записан на рейд').catch((error) => console.error('Не удалось выдать роль рейда:', error));
}

/** Снимает роль, если игрок не записан ни на один другой рейд, где роль ещё нужна. */
export async function revokeRaidRole(guild: Guild, userId: string, raidId: number): Promise<void> {
  const role = raidRole(guild);
  if (!role || hasOtherActiveSignup(userId, raidId, Date.now(), holdMs())) return;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member?.roles.cache.has(role.id)) return;
  await member.roles.remove(role, 'Рейд завершён или запись отменена').catch((error) => console.error('Не удалось снять роль рейда:', error));
}

/** Тик планировщика: снять роль у участников рег, которые закончились (или отменены). */
export async function cleanupRaidRoles(client: Client<true>): Promise<void> {
  for (const raid of raidsDueForRoleCleanup(Date.now(), holdMs())) {
    const guild = client.guilds.cache.get(raid.guildId);
    if (!guild) continue; // сервер недоступен — попробуем на следующем тике
    for (const signup of getSignups(raid.id)) await revokeRaidRole(guild, signup.userId, raid.id);
    // Отмечаем после снятия: если бот упадёт посередине, после перезапуска чистка повторится.
    markRoleCleaned(raid.id);
  }
}
