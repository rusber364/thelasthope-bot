// Архив прошедших рег: через N часов после начала рега уходит из канала рег.
// move — итог и финальный состав переносятся в канал-архив; delete — рега удаляется, в канале остаётся итог.
import { EmbedBuilder, TimestampStyles, time, type Client, type GuildTextBasedChannel } from 'discord.js';
import { getSettings } from '../botSettings.ts';
import { LOG_COLORS } from '../logs/send.ts';
import { ROLES, ROLE_ORDER, specById, type RaidRole } from './classes.ts';
import { buildRaidMessage } from './render.ts';
import { attendanceCounts, getSignups, markArchived, raidsDueForArchive, type AttendanceStatus, type Raid, type Signup } from './store.ts';

const HOUR = 60 * 60 * 1000;

/** Краткий итог реги: дата, статус, состав по ролям, посещаемость. */
export function raidSummary(raid: Raid, signups: Signup[], attendance: Partial<Record<AttendanceStatus, number>>): EmbedBuilder {
  const confirmed = signups.filter((s) => !s.tentative);
  const main = confirmed.slice(0, raid.size);
  const bench = confirmed.length - main.length;
  const tentative = signups.length - confirmed.length;

  const byRole = new Map<RaidRole, number>(ROLE_ORDER.map((role) => [role, 0]));
  for (const signup of main) {
    const role = specById.get(signup.specId)?.role ?? 'melee';
    byRole.set(role, (byRole.get(role) ?? 0) + 1);
  }
  const roles = ROLE_ORDER.map((role) => `${ROLES[role].title} ${byRole.get(role)}`).join(' · ');
  const cancelled = raid.status === 'cancelled';

  const lines = [
    `**Дата:** ${time(new Date(raid.startsAt), TimestampStyles.FullDateShortTime)}`,
    `**Статус:** ${cancelled ? 'отменён' : 'проведён'}`,
    `**Состав:** ${main.length}/${raid.size} — ${roles}`,
  ];
  if (bench) lines.push(`**Запас:** ${bench}`);
  if (tentative) lines.push(`**Под вопросом:** ${tentative}`);
  if (attendance.present !== undefined || attendance.absent !== undefined) {
    lines.push(`**Посещаемость:** пришли ${attendance.present ?? 0}, не пришли ${attendance.absent ?? 0}` +
      (attendance.walkin ? `, без записи ${attendance.walkin}` : ''));
  }

  return new EmbedBuilder()
    .setColor(cancelled ? LOG_COLORS.delete : LOG_COLORS.update)
    .setTitle(`Итог: ${raid.title}`)
    .setDescription(lines.join('\n'))
    .setFooter({ text: `Рега #${raid.id}` });
}

async function textChannel(client: Client<true>, id: string | null): Promise<GuildTextBasedChannel | null> {
  if (!id) return null;
  const channel = await client.channels.fetch(id).catch(() => null);
  return channel?.isTextBased() && !channel.isDMBased() ? channel : null;
}

let warned = false;

/** Тик планировщика: архивирует реги, с начала которых прошло archive.hours часов. */
export async function archiveRaids(client: Client<true>): Promise<void> {
  const { archive } = getSettings().raids;
  if (archive.mode === 'off') return;

  for (const raid of raidsDueForArchive(Date.now(), archive.hours * HOUR)) {
    const signups = getSignups(raid.id);
    const summary = raidSummary(raid, signups, attendanceCounts(raid.id));
    const channel = await textChannel(client, raid.channelId);

    if (archive.mode === 'move') {
      const target = await textChannel(client, archive.channelId);
      if (!target) {
        if (!warned) console.warn('⚠️ Канал-архив рег не найден — реги пока не переношу. Проверь его в админке.');
        warned = true;
        return;
      }
      // Финальный состав — тот же embed, что был на реге, но без баннера и кнопок.
      const roster = buildRaidMessage(raid, signups).embeds.at(-1)!;
      await target.send({ embeds: [summary, roster], allowedMentions: { parse: [] } });
    } else if (channel) {
      await channel.send({ embeds: [summary], allowedMentions: { parse: [] } });
    }

    if (channel && raid.messageId) await channel.messages.delete(raid.messageId).catch(() => {});
    markArchived(raid.id);
  }
}
