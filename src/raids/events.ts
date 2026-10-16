// События Discord для рег (как в Raid-Helper Premium): рейд виден во вкладке «События» сервера,
// Discord сам напоминает тем, кто нажал «Интересует». Событие «внешнее»: место — ссылка на регу.
import {
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  GuildScheduledEventStatus,
  PermissionFlagsBits,
  type Client,
} from 'discord.js';
import { getSettings } from '../botSettings.ts';
import { findBanner } from './render.ts';
import { getRaid, getRaidEventId, getRaidImage, setRaidEventId, type Raid } from './store.ts';

/** Сколько длится событие в календаре Discord: в конце Discord сам отмечает его завершённым. */
const EVENT_HOURS = 3;
const HOUR = 60 * 60 * 1000;

const raidLink = (raid: Raid) => `https://discord.com/channels/${raid.guildId}/${raid.channelId}${raid.messageId ? `/${raid.messageId}` : ''}`;

/** Название, время, место и описание события по реге (чистая функция). */
export function eventFields(raid: Raid) {
  const link = raidLink(raid);
  const description = `${raid.description ? `${raid.description}\n\n` : ''}Запись на рейд: ${link}`;
  return {
    name: raid.title.slice(0, 100),
    scheduledStartTime: new Date(raid.startsAt),
    scheduledEndTime: new Date(raid.startsAt + EVENT_HOURS * HOUR),
    entityMetadata: { location: link.slice(0, 100) },
    description: description.length > 1000 ? `${description.slice(0, 1000 - link.length - 3)}…\n${link}` : description,
  };
}

let warned = false;

/**
 * Привести событие Discord к состоянию реги: открыта — создать или обновить, отменена — отменить,
 * началась — отметить идущим. Без права «Создавать события» ничего не делает (одно предупреждение в консоль).
 */
export async function syncRaidEvent(client: Client, raidId: number): Promise<void> {
  const raid = getRaid(raidId);
  const guild = raid ? client.guilds.cache.get(raid.guildId) : undefined;
  if (!raid || !guild) return;
  const eventId = getRaidEventId(raid.id);
  if (raid.status === 'open' && !eventId && !getSettings().raids.discordEvents) return;

  if (!guild.members.me?.permissions.has(PermissionFlagsBits.CreateEvents)) {
    if (!warned) console.warn('ℹ️ События Discord для рег не создаются: дай роли бота право «Создавать события».');
    warned = true;
    return;
  }

  if (raid.status !== 'open') {
    if (!eventId) return;
    const status = raid.status === 'cancelled' ? GuildScheduledEventStatus.Canceled : GuildScheduledEventStatus.Active;
    // Событие могли удалить или уже завершить вручную — это не ошибка.
    await guild.scheduledEvents.edit(eventId, { status }).catch(() => {});
    return;
  }

  const fields = eventFields(raid);
  if (eventId) {
    const updated = await guild.scheduledEvents.edit(eventId, fields).then(
      () => true,
      () => false, // событие удалили руками — создадим заново
    );
    if (updated) return;
  }
  const custom = getRaidImage(raid.id);
  const image = custom?.data ?? findBanner()?.path ?? null;
  const event = await guild.scheduledEvents.create({
    ...fields,
    privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
    entityType: GuildScheduledEventEntityType.External,
    ...(image ? { image } : {}),
  });
  setRaidEventId(raid.id, event.id);
}

/** Синхронизация без ожидания — для мест, где ответ пользователю важнее (публикация, отмена, перенос). */
export function syncRaidEventLater(client: Client, raidId: number): void {
  void syncRaidEvent(client, raidId).catch((error) => console.error(`Не удалось обновить событие Discord для реги #${raidId}:`, error));
}
