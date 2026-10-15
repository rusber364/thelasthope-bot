// «Кто кого пригласил»: бот помнит, сколько раз использовано каждое приглашение,
// а при входе нового участника смотрит, у какого счётчик вырос.
// Счётчики Discord отдаёт только боту с правом «Управлять сервером».
import { Events, type Client, type Guild, type Invite } from 'discord.js';

interface InviteInfo {
  uses: number;
  inviterId: string | null;
}

/** сервер → (код приглашения → счётчик). Нет записи — счётчики недоступны (нет права). */
const known = new Map<string, Map<string, InviteInfo>>();

function snapshot(invites: Iterable<Invite>): Map<string, InviteInfo> {
  const map = new Map<string, InviteInfo>();
  for (const invite of invites) map.set(invite.code, { uses: invite.uses ?? 0, inviterId: invite.inviterId });
  return map;
}

/** Без права «Управлять сервером» Discord не присылает счётчики — тогда uses у всех null. */
async function fetchWithUses(guild: Guild): Promise<Map<string, InviteInfo> | null> {
  try {
    const invites = await guild.invites.fetch({ cache: false });
    if (invites.size && invites.every((invite) => invite.uses === null)) return null;
    return snapshot(invites.values());
  } catch {
    return null;
  }
}

export async function cacheInvites(guild: Guild): Promise<void> {
  const map = await fetchWithUses(guild);
  if (map) known.set(guild.id, map);
  else {
    known.delete(guild.id);
    console.log(`ℹ️ «${guild.name}»: не вижу счётчики приглашений — для «кто кого пригласил» нужно право «Управлять сервером».`);
  }
}

export function registerInviteTracking(client: Client): void {
  client.on(Events.InviteCreate, (invite) => {
    if (invite.guild) known.get(invite.guild.id)?.set(invite.code, { uses: invite.uses ?? 0, inviterId: invite.inviterId });
  });
  client.on(Events.InviteDelete, (invite) => {
    // Не удаляем сразу: одноразовое приглашение исчезает как раз при входе по нему.
    if (invite.guild) setTimeout(() => known.get(invite.guild!.id)?.delete(invite.code), 30_000);
  });
}

/** Описание приглашения, по которому только что зашёл участник, для «лог-дискорда». */
export async function detectInvite(guild: Guild): Promise<string> {
  const before = known.get(guild.id);
  const now = before ? await fetchWithUses(guild) : null;
  if (!before || !now) return 'неизвестно — у бота нет права «Управлять сервером»';
  known.set(guild.id, now);

  const describe = (code: string, info: InviteInfo, note = '') =>
    `discord.gg/${code}${note} — от ${info.inviterId ? `<@${info.inviterId}>` : 'неизвестно'} (использований: ${info.uses})`;

  for (const [code, info] of now) {
    if (info.uses > (before.get(code)?.uses ?? 0)) return describe(code, info);
  }
  // Одноразовое или исчерпанное приглашение после входа удаляется — его нет в новом списке.
  for (const [code, info] of before) {
    if (!now.has(code)) return describe(code, { ...info, uses: info.uses + 1 }, ' (одноразовое)');
  }
  if (guild.vanityURLCode) return `своя ссылка сервера discord.gg/${guild.vanityURLCode}`;
  return 'не удалось определить';
}
