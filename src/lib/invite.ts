import { OAuth2Scopes, PermissionFlagsBits, PermissionsBitField } from 'discord.js';

/** Права, которые нужны боту на сервере. Попадают в ссылку-приглашение. */
export const BOT_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.UseExternalEmojis,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.ViewAuditLog, // журнал аудита — для лог-сервер и лог-модерация
  PermissionFlagsBits.ManageGuild, // счётчики приглашений — только для «кто кого пригласил»
  PermissionFlagsBits.CreateEvents, // события Discord для рег
  PermissionFlagsBits.ManageChannels, // временные каналы (/tempchannel)
];

/** Ссылка, по которой бота добавляют на сервер — сразу с нужными правами и слэш-командами. */
export function inviteUrl(clientId: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    scope: [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands].join(' '),
    permissions: new PermissionsBitField(BOT_PERMISSIONS).bitfield.toString(),
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}
