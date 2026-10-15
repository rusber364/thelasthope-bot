import type { ChatInputCommandInteraction, GuildMember } from 'discord.js';

/**
 * Проверяет, может ли модератор наказать участника.
 * Возвращает текст причины отказа или null, если всё в порядке.
 * (Может ли это сделать сам бот, проверяют свойства member.kickable / bannable / moderatable.)
 */
export function hierarchyProblem(moderator: GuildMember, target: GuildMember): string | null {
  if (target.id === moderator.id) return 'Нельзя применить это к самому себе.';
  if (target.id === target.guild.ownerId) return 'Нельзя применить это к владельцу сервера.';
  if (target.id === target.client.user.id) return 'Себя наказывать я не буду 🙂';

  const isOwner = moderator.id === moderator.guild.ownerId;
  if (!isOwner && target.roles.highest.comparePositionTo(moderator.roles.highest) >= 0) {
    return 'Роль этого участника не ниже твоей самой высокой роли.';
  }
  return null;
}

/** Причина для журнала аудита Discord. Там исполнителем значится бот, поэтому дописываем модератора. */
export function auditReason(interaction: ChatInputCommandInteraction, reason: string): string {
  return `${reason} — модератор: ${interaction.user.tag}`;
}

export const NO_REASON = 'Причина не указана';
