import type { Guild } from 'discord.js';

/** Имена участников для итогов и статистики: «Ник (@логин)». Кого не нашли (ушли с сервера) — пропускаем. */
export async function memberNames(guild: Guild, userIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (let i = 0; i < userIds.length; i += 100) {
    const chunk = userIds.slice(i, i + 100);
    const members = await guild.members.fetch({ user: chunk }).catch(() => null);
    members?.forEach((member) => names.set(member.id, `${member.displayName} (@${member.user.username})`));
  }
  return names;
}
