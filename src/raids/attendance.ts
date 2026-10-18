// Посещаемость рейда: кто из записавшихся сидит в голосовом через N минут после начала.
import { EmbedBuilder, type Guild } from 'discord.js';
import { getSettings } from '../botSettings.ts';
import { sendAlert } from '../logs/alerts.ts';
import { LOG_COLORS } from '../logs/send.ts';
import { lineup } from './lineup.ts';
import { raidUrl } from './service.ts';
import { getSignups, saveAttendance, type AttendanceStatus, type Raid, type Signup } from './store.ts';

export interface AttendanceResult {
  present: Signup[];
  /** Основной состав, которого нет в голосовом. */
  absent: Signup[];
  /** Отметились «под вопросом» и не пришли — офицерам это менее важно, но видно отдельно. */
  tentativeAbsent: Signup[];
  /** В голосовом рейда, но не записаны. Считаются, только если выбран конкретный голосовой канал. */
  walkins: string[];
  mainCount: number;
}

/** Чистый подсчёт (без Discord): записи + кто сейчас в голосовом. */
export function computeAttendance(signups: Signup[], size: number, inVoice: Set<string>, countWalkins: boolean): AttendanceResult {
  const { main, bench, tentative } = lineup(signups, size);
  const signed = new Set(signups.map((s) => s.userId));

  return {
    present: [...main, ...bench, ...tentative].filter((s) => inVoice.has(s.userId)),
    absent: main.filter((s) => !inVoice.has(s.userId)),
    tentativeAbsent: tentative.filter((s) => !inVoice.has(s.userId)),
    walkins: countWalkins ? [...inVoice].filter((id) => !signed.has(id)) : [],
    mainCount: main.length,
  };
}

function names(list: Signup[]): string {
  if (!list.length) return '—';
  const text = list.map((s) => `<@${s.userId}>`).join(' ');
  return text.length > 1024 ? `${text.slice(0, 1000)}… (${list.length})` : text;
}

/** Проверяет посещаемость, сохраняет её в базу и шлёт отчёт офицерам. */
export async function reportAttendance(guild: Guild, raid: Raid): Promise<void> {
  const voiceId = getSettings().raids.attendanceVoiceChannelId;
  const inVoice = new Set(
    guild.voiceStates.cache
      .filter((state) => state.channelId && (!voiceId || state.channelId === voiceId) && !state.member?.user.bot)
      .map((state) => state.id),
  );
  const result = computeAttendance(getSignups(raid.id), raid.size, inVoice, Boolean(voiceId));

  const rows: { userId: string; status: AttendanceStatus }[] = [
    ...result.present.map((s) => ({ userId: s.userId, status: 'present' as const })),
    ...result.absent.map((s) => ({ userId: s.userId, status: 'absent' as const })),
    ...result.tentativeAbsent.map((s) => ({ userId: s.userId, status: 'tentative_absent' as const })),
    ...result.walkins.map((userId) => ({ userId, status: 'walkin' as const })),
  ];
  saveAttendance(raid.id, rows);

  const presentMain = result.mainCount - result.absent.length;
  const embed = new EmbedBuilder()
    .setColor(result.absent.length ? LOG_COLORS.warn : LOG_COLORS.create)
    .setTitle(`Посещаемость: ${raid.title}`)
    .setDescription(
      `[Открыть регу](${raidUrl(raid)}) · в голосовом ${voiceId ? `<#${voiceId}>` : '(любом)'} пришли **${presentMain} из ${result.mainCount}** основного состава`,
    )
    .addFields(
      { name: `Пришли (${result.present.length})`, value: names(result.present) },
      { name: `Не пришли (${result.absent.length})`, value: names(result.absent) },
    );
  if (result.tentativeAbsent.length) {
    embed.addFields({ name: `Под вопросом, не пришли (${result.tentativeAbsent.length})`, value: names(result.tentativeAbsent) });
  }
  if (result.walkins.length) {
    embed.addFields({ name: `Пришли без записи (${result.walkins.length})`, value: result.walkins.map((id) => `<@${id}>`).join(' ').slice(0, 1024) });
  }
  await sendAlert(guild, embed);
}
