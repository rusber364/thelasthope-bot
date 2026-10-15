// Планировщик: раз в 30 секунд проверяет, не пора ли
//  • открыть регу по расписанию (чт, пт, пн в 00:00),
//  • напомнить записавшимся за сутки и за час,
//  • закрыть запись, когда рейд начался.
// Всё, что уже сделано, отмечено в базе — поэтому перезапуск бота ничего не задвоит.
import type { Client, GuildTextBasedChannel } from 'discord.js';
import { settings } from '../settings.ts';
import { latestSlot, nowZoned, parseTime } from '../lib/time.ts';
import { uiEmoji } from './emojis.ts';
import { describeSignup, messageSignups, publishRaid, raidUrl, raidWhen, refreshRaidMessage } from './service.ts';
import { markReminded, raidsDueForReminder, raidsToClose, scheduleKeyExists, setRaidStatus, type ReminderKind } from './store.ts';

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
      await closeStartedRaids(client);
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
  for (const schedule of settings.raids.schedules) {
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
      size: settings.raids.defaultSize,
      createdBy: 'schedule',
      leaderName: channel.guild.name,
      scheduleKey: key,
    });
    console.log(`📅 Открыта рега #${raid.id} «${raid.title}» в #${channel.name}`);
  }
}

export async function fetchRaidChannel(client: Client<true>, channelId: string): Promise<GuildTextBasedChannel | null> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) return null;
  return channel;
}

async function sendReminders(client: Client<true>): Promise<void> {
  for (const { kind, lead } of REMINDERS) {
    for (const raid of raidsDueForReminder(kind, Date.now(), lead)) {
      // Сначала отмечаем, потом рассылаем: при сбое лучше пропустить напоминание, чем отправить его дважды.
      markReminded(raid.id, kind);
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
