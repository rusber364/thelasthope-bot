// Планировщик: раз в 30 секунд проверяет, не пора ли
//  • открыть регу по расписанию (чт, пт, пн в 00:00) и упомянуть роль,
//  • напомнить записавшимся в личку за сутки и за час,
//  • позвать на сбор в канале реги за N минут до начала,
//  • закрыть запись, когда рейд начался,
//  • через N минут после начала проверить, кто в голосовом, и отчитаться офицерам,
//  • через N часов после начала снять временную роль рейда и убрать регу в архив.
// Всё, что уже сделано, отмечено в базе — поэтому перезапуск бота ничего не задвоит.
import { TimestampStyles, time, type Client, type GuildTextBasedChannel } from 'discord.js';
import { getSettings } from '../botSettings.ts';
import { settings } from '../settings.ts';
import { latestSlot, nowZoned, parseTime } from '../lib/time.ts';
import { archiveRaids } from './archive.ts';
import { reportAttendance } from './attendance.ts';
import { cleanupRaidRoles } from './tempRole.ts';
import { uiEmoji } from './emojis.ts';
import { describeSignup, messageSignups, publishRaid, raidUrl, raidWhen, refreshRaidMessage } from './service.ts';
import {
  getSignups,
  markAttendanceDone,
  markReminded,
  raidsDueForAttendance,
  raidsDueForReminder,
  raidsToClose,
  scheduleKeyExists,
  setRaidStatus,
  type ReminderKind,
} from './store.ts';

const HOUR = 60 * 60 * 1000;
const REMINDERS: { kind: ReminderKind; lead: number }[] = [
  { kind: 'day', lead: 24 * HOUR },
  { kind: 'hour', lead: HOUR },
];

export function startRaidScheduler(client: Client<true>): void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await openScheduledRaids(client);
      await sendReminders(client);
      await sendGatherCalls(client);
      await closeStartedRaids(client);
      await checkAttendance(client);
      await cleanupRaidRoles(client);
      await archiveRaids(client);
    } catch (error) {
      console.error('Ошибка планировщика рейдов:', error);
    } finally {
      running = false;
    }
  };
  void tick();
  setInterval(tick, 30_000);
}

const warned = new Set<string>();

async function openScheduledRaids(client: Client<true>): Promise<void> {
  const now = nowZoned();
  // Расписание читается на каждом тике — изменения из админки подхватываются без перезапуска.
  const { raids } = getSettings();
  for (const schedule of raids.schedules) {
    if (!schedule.channelId) continue;
    const openAt = parseTime(schedule.openAt);
    const raidTime = parseTime(schedule.raidTime);
    if (!openAt || !raidTime) {
      warnOnce(`time:${schedule.id}`, `Неверное время в расписании «${schedule.id}» (нужно ЧЧ:ММ).`);
      continue;
    }

    const slot = latestSlot(now, schedule.days, openAt);
    if (!slot || now.since(slot).total('hours') > settings.raids.catchUpHours) continue;

    const key = `${schedule.id}:${slot.toPlainDate().toString()}`;
    if (scheduleKeyExists(key)) continue;

    const start = slot.toPlainDate().add({ days: schedule.raidDayOffset }).toZonedDateTime({
      timeZone: settings.timeZone,
      plainTime: raidTime,
    });
    if (start.epochMilliseconds <= Date.now()) continue;

    const channel = await fetchRaidChannel(client, schedule.channelId);
    if (!channel) {
      warnOnce(`channel:${schedule.id}`, `Канал ${schedule.channelId} для расписания «${schedule.id}» не найден или бот не может туда писать.`);
      continue;
    }

    const raid = await publishRaid(channel, {
      title: schedule.title,
      startsAt: start.epochMilliseconds,
      size: raids.defaultSize,
      createdBy: 'schedule',
      leaderName: channel.guild.name,
      scheduleKey: key,
    }, schedule.pingRoleId);
    console.log(`📅 Открыта рега #${raid.id} «${raid.title}» в #${channel.name}`);
  }
}

export async function fetchRaidChannel(client: Client<true>, channelId: string): Promise<GuildTextBasedChannel | null> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) return null;
  return channel;
}

export async function sendReminders(client: Client<true>): Promise<void> {
  const now = Date.now();
  // Ближайшее напоминание — первым. Если пора сразу нескольким (до рейда меньше часа, а «за сутки» ещё не было:
  // рега создана незадолго до начала или бот был выключен), участник получает одно, остальные просто отмечаются.
  const reminded = new Set<number>();
  for (const { kind, lead } of [...REMINDERS].sort((a, b) => a.lead - b.lead)) {
    for (const raid of raidsDueForReminder(kind, now, lead)) {
      // Сначала отмечаем, потом рассылаем: при сбое лучше пропустить напоминание, чем отправить его дважды.
      markReminded(raid.id, kind);
      if (reminded.has(raid.id)) continue;
      reminded.add(raid.id);
      await messageSignups(client, raid, (signup) =>
        [
          `${uiEmoji('countdown')} **Напоминание:** рейд **${raid.title}** начнётся ${raidWhen(raid)}.`,
          `Твоя запись: ${describeSignup(signup)}${signup.tentative ? ' (под вопросом)' : ''}.`,
          `[Открыть регу](${raidUrl(raid)})`,
        ].join('\n'),
      );
    }
  }
}

/** «Сбор!» в канале реги с упоминанием всех записавшихся (кроме запаса — им не обязательно). */
async function sendGatherCalls(client: Client<true>): Promise<void> {
  const { gatherMinutes, attendanceVoiceChannelId } = getSettings().raids;
  if (!gatherMinutes) return;
  for (const raid of raidsDueForReminder('gather', Date.now(), gatherMinutes * 60_000)) {
    markReminded(raid.id, 'gather');
    const signups = getSignups(raid.id);
    const confirmed = signups.filter((s) => !s.tentative).slice(0, raid.size);
    const tentative = signups.filter((s) => s.tentative);
    const ids = [...confirmed, ...tentative].map((s) => s.userId).slice(0, 100);
    if (!ids.length) continue;

    const channel = await fetchRaidChannel(client, raid.channelId);
    if (!channel) continue;
    const start = new Date(raid.startsAt);
    const voice = attendanceVoiceChannelId ? ` Заходите в <#${attendanceVoiceChannelId}>.` : '';
    try {
      await channel.send({
        content: [
          `${uiEmoji('countdown')} **Сбор!** Рейд **${raid.title}** начнётся ${time(start, TimestampStyles.RelativeTime)} (${time(start, TimestampStyles.ShortTime)}).${voice}`,
          ids.map((id) => `<@${id}>`).join(' '),
        ].join('\n'),
        allowedMentions: { users: ids },
      });
    } catch (error) {
      console.error(`Не удалось позвать на сбор (рега #${raid.id}):`, error);
    }
  }
}

async function checkAttendance(client: Client<true>): Promise<void> {
  const { attendanceMinutes } = getSettings().raids;
  if (!attendanceMinutes) return;
  for (const raid of raidsDueForAttendance(Date.now(), attendanceMinutes * 60_000)) {
    markAttendanceDone(raid.id);
    const guild = client.guilds.cache.get(raid.guildId);
    if (guild) await reportAttendance(guild, raid);
  }
}

async function closeStartedRaids(client: Client<true>): Promise<void> {
  for (const raid of raidsToClose(Date.now())) {
    setRaidStatus(raid.id, 'closed');
    await refreshRaidMessage(client, raid.id);
  }
}

function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`⚠️ ${message}`);
}
