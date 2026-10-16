// Роли на время (как в Carl-bot Premium): роль с панели снимается сама через заданный срок.
// Срок хранится в базе, поэтому роль снимется и после перезапуска бота.
import type { Client } from 'discord.js';
import { db } from '../db.ts';

const CHECK_EVERY_MS = 60_000;

/** Запомнить, когда снять роль (повторная выдача продлевает срок). */
export function scheduleRoleExpiry(guildId: string, userId: string, roleId: string, expiresAt: number): void {
  db.prepare(
    `INSERT INTO temp_roles (guild_id, user_id, role_id, expires_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (guild_id, user_id, role_id) DO UPDATE SET expires_at = excluded.expires_at`,
  ).run(guildId, userId, roleId, expiresAt);
}

export function cancelRoleExpiry(guildId: string, userId: string, roleId: string): void {
  db.prepare('DELETE FROM temp_roles WHERE guild_id = ? AND user_id = ? AND role_id = ?').run(guildId, userId, roleId);
}

export function roleExpiry(guildId: string, userId: string, roleId: string): number | null {
  const row = db.prepare('SELECT expires_at FROM temp_roles WHERE guild_id = ? AND user_id = ? AND role_id = ?').get(guildId, userId, roleId) as
    | { expires_at: number }
    | undefined;
  return row ? Number(row.expires_at) : null;
}

/** Снять роли, срок которых истёк. Ушедших с сервера и удалённые роли просто забываем. */
export async function expireTempRoles(client: Client, now = Date.now()): Promise<void> {
  const due = db.prepare('SELECT guild_id, user_id, role_id FROM temp_roles WHERE expires_at <= ?').all(now) as { guild_id: string; user_id: string; role_id: string }[];
  for (const { guild_id: guildId, user_id: userId, role_id: roleId } of due) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue; // бот не видит сервер — попробуем в следующий раз
    try {
      const member = await guild.members.fetch(userId).catch(() => null);
      const role = guild.roles.cache.get(roleId);
      if (member && role && member.roles.cache.has(roleId)) await member.roles.remove(role, 'Срок роли с панели истёк');
      cancelRoleExpiry(guildId, userId, roleId);
    } catch (error) {
      console.error(`Не удалось снять роль ${roleId} у ${userId} по сроку:`, error);
    }
  }
}

export function startTempRoleExpiry(client: Client): void {
  const run = () => void expireTempRoles(client).catch((error) => console.error('Роли на время:', error));
  run();
  setInterval(run, CHECK_EVERY_MS);
}
