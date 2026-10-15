import type { Client } from 'discord.js';
import { registerAuditLogs } from './auditLog.ts';
import { registerInviteTracking } from './invites.ts';
import { registerMemberLogs } from './members.ts';
import { registerMessageLogs } from './messages.ts';
import { registerVoiceLogs } from './voice.ts';

/** Подписка на все события, которые пишутся в лог-каналы. */
export function registerLogs(client: Client): void {
  registerInviteTracking(client);
  registerMemberLogs(client);
  registerMessageLogs(client);
  registerVoiceLogs(client);
  registerAuditLogs(client);
}
