// Планировщик: в начале каждой минуты открывает реги по расписанию шаблонов рейдов (например, во вторник в 00:00
// на среду 20:00) и упоминает роли, а раз в 30 секунд проверяет, не пора ли
//  • напомнить записавшимся в личку за сутки и за час,
//  • позвать на сбор в канале реги за N минут до начала,
//  • закрыть запись, когда рейд начался,
//  • через N минут после начала проверить, кто в голосовом, и отчитаться офицерам,
//  • через N часов после начала снять временную роль рейда и убрать регу в архив.
// Всё, что уже сделано, отмечено в базе — поэтому перезапуск бота ничего не задвоит.
import { TimestampStyles, time, type Client, type GuildTextBasedChannel } from 'discord.js';
import { getSettings, type RaidTemplate } from '../botSettings.ts';
import { nowZoned } from '../lib/time.ts';
import { lineup } from './lineup.ts';
import { dueOpenings } from './slots.ts';
import { archiveRaids } from './archive.ts';
import { reportAttendance } from './attendance.ts';
import { cleanupRaidRoles } from './tempRole.ts';
import { uiEmoji } from './emojis.ts';
import { describeSignup, messageSignups, publishRaid, raidUrl, raidWhen, refreshRaidMessage } from './service.ts';
import { syncRaidEventLater } from './events.ts';
import { sendPersonalReminders } from './personalReminders.ts';
import {
  getSignups,
  markAttendanceDone,
  markReminded,
  raidsDueForAttendance,
  raidsDueForReminder,
  raidsToClose,
  scheduleKeyExists,
  setRaidStatus,
  type NewRaid,
  type ReminderKind,
} from './store.ts';

const HOUR = 60 * 60 * 1000;
const REMINDERS: { kind: ReminderKind; lead: number }[] = [
  { kind: 'day', lead: 24 * HOUR },
  { kind: 'hour', lead: HOUR },
];

const MINUTE = 60_000;

/** Через сколько мс начало следующей минуты (+0,5 с запаса): реги по расписанию открываются ровно в ЧЧ:ММ:00. */
export function msToNextMinute(now: number): number {
  return MINUTE - (now % MINUTE) + 500;
}

export function startRaidScheduler(client: Client<true>): void {
  // Открытие рег — отдельно и в начале каждой минуты: рега появляется в первые секунды, а не через 0–30 с,
  // и долгая рассылка напоминаний его не задерживает. После запуска — сразу, чтобы догнать пропущенное.
  const open = withoutOverlap(() => openScheduledRaids(client), 'Ошибка открытия рег по расписанию:');
  void open();
  const atNextMinute = () =>
    setTimeout(() => {
      void open();
      atNextMinute();
    }, msToNextMinute(Date.now()));
  atNextMinute();

  const tick = withoutOverlap(async () => {
    await sendReminders(client);
    await sendPersonalReminders(client);
    await sendGatherCalls(client);
    await closeStartedRaids(client);
    await checkAttendance(client);
    await cleanupRaidRoles(client);
    await archiveRaids(client);
  }, 'Ошибка планировщика рейдов:');
  void tick();
  setInterval(tick, 30_000);
}

/** Запуск без наложений: пока прошлый проход не закончился, новый пропускается. */
function withoutOverlap(run: () => Promise<void>, errorText: string): () => Promise<void> {
  let running = false;
  return async () => {
    if (running) return;
    running = true;
    try {
      await run();
    } catch (error) {
      console.error(errorText, error);
    } finally {
      running = false;
    }
  };
}

const warned = new Set<string>();

async function openScheduledRaids(client: Client<true>): Promise<void> {
  // Шаблоны читаются на каждом тике — изменения из админки подхватываются без перезапуска.
  for (const { template, key, startsAt } of dueOpenings(nowZoned(), getSettings().raidTemplates)) {
    if (scheduleKeyExists(key)) continue;
    const channel = await fetchRaidChannel(client, template.channelId ?? '');
    if (!channel) {
      warnOnce(`channel:${template.id}`, `Канал ${template.channelId} шаблона «${template.title}» не найден или бот не может туда писать.`);
      continue;
    }
    const raid = await publishRaid(
      channel,
      raidFromTemplate(template, { startsAt, createdBy: 'schedule', leaderName: channel.guild.name, scheduleKey: key }),
      template.pingRoleIds,
    );
    console.log(`📅 Открыта рега #${raid.id} «${raid.title}» в #${channel.name}`);
  }
}

/** Рега по шаблону: название, описание, размер и кто может записаться — из шаблона (снимок: правка шаблона регу не меняет). */
export function raidFromTemplate(
  template: RaidTemplate,
  when: { startsAt: number; createdBy: string; leaderName: string; scheduleKey?: string },
): Omit<NewRaid, 'guildId' | 'channelId'> {
  return {
    title: template.title,
    description: template.description || null,
    size: template.size,
    mainRoleIds: template.mainRoleIds,
    reserveRoleIds: template.reserveRoleIds,
    ...when,
  };
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
    const { main, tentative } = lineup(getSignups(raid.id), raid.size);
    const ids = [...main, ...tentative].map((s) => s.userId).slice(0, 100);
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
    syncRaidEventLater(client, raid.id);
  }
}

function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`⚠️ ${message}`);
}
