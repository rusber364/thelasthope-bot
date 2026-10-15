import { PermissionFlagsBits, type Role } from 'discord.js';
import type { ComponentHandler } from '../types.ts';
import { replyEphemeral } from './reply.ts';

/**
 * У каждой кнопки есть customId — строка, которую Discord вернёт боту при нажатии.
 * Мы кладём туда ID роли (`role:123…`), поэтому базу данных для панелей ролей заводить не нужно:
 * всё, что нужно знать при нажатии, уже есть в самой кнопке.
 */
export const ROLE_BUTTON_PREFIX = 'role:';

/** Можно ли раздавать роль через кнопки. Возвращает текст проблемы или null. */
export function roleButtonProblem(role: Role): string | null {
  if (role.id === role.guild.id) return 'Роль @everyone и так есть у всех.';
  if (role.managed) return `Роль ${role} управляется интеграцией или другим ботом.`;
  if (role.permissions.has(PermissionFlagsBits.Administrator)) {
    return `Роль ${role} даёт права администратора — раздавать её кнопкой опасно.`;
  }
  if (!role.editable) return `Не могу выдавать роль ${role}: моя роль должна стоять выше неё (Настройки сервера → Роли).`;
  return null;
}

/** Нажатие на кнопку роли: если роли нет — выдаём, если есть — снимаем. */
export const roleButtonHandler: ComponentHandler = {
  prefix: 'role',
  async handle(interaction, [roleId]) {
    if (!interaction.isButton() || !roleId) return;
    const role = interaction.guild.roles.cache.get(roleId);

    if (!role) return replyEphemeral(interaction, 'Этой роли больше нет на сервере. Попроси администратора обновить панель.');
    const problem = roleButtonProblem(role);
    if (problem) return replyEphemeral(interaction, problem);

    const { member } = interaction;
    if (member.roles.cache.has(role.id)) {
      await member.roles.remove(role, 'Панель ролей');
      await replyEphemeral(interaction, `➖ Роль ${role} снята.`);
    } else {
      await member.roles.add(role, 'Панель ролей');
      await replyEphemeral(interaction, `➕ Роль ${role} выдана.`);
    }
  },
};
