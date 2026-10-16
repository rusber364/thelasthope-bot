// Действия с регами, которые нужны и командам, и кнопкам, и планировщику.
import { MessageFlags, PermissionFlagsBits, TimestampStyles, time, type Client, type GuildTextBasedChannel } from 'discord.js';
import { settings } from '../settings.ts';
import { classById, specById } from './classes.ts';
import { requestBoardRefresh } from './board.ts';
import { specEmoji } from './emojis.ts';
import { buildRaidCreateMessage, buildRaidMessage } from './render.ts';
import {
  createRaid,
  deleteRaid,
  getRaid,
  getRaidImage,
  getSignups,
  saveRaidImage,
  setRaidMessage,
  type NewRaid,
  type Raid,
  type RaidImage,
  type Signup,
} from './store.ts';

/** Права бота в канале реги: видеть канал, писать, встраивать ссылки и прикреплять картинку. */
export const RAID_PUBLISH_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
];

/**
 * Создаёт регу в базе и публикует сообщение в канале. pingRoleId — какую роль упомянуть при открытии,
 * image — своя картинка реги (сохраняется, чтобы прикреплять её при каждой перерисовке).
 */
export async function publishRaid(
  channel: GuildTextBasedChannel,
  input: Omit<NewRaid, 'guildId' | 'channelId'>,
  pingRoleId: string | null = null,
  image: RaidImage | null = null,
): Promise<Raid> {
  const raid = createRaid({ ...input, guildId: channel.guild.id, channelId: channel.id });
  if (image) saveRaidImage(raid.id, image);
  try {
    const message = await channel.send(buildRaidCreateMessage(raid, [], pingRoleId, image));
    setRaidMessage(raid.id, message.id);
    requestBoardRefresh(channel.client, raid.guildId);
    return { ...raid, messageId: message.id };
  } catch (error) {
    deleteRaid(raid.id); // чтобы планировщик попробовал создать её ещё раз
    throw error;
  }
}

export function raidUrl(raid: Raid): string {
  return `https://discord.com/channels/${raid.guildId}/${raid.channelId}/${raid.messageId ?? ''}`;
}

const refreshing = new Map<number, Promise<void>>();
const pending = new Set<number>();

/**
 * Перерисовывает сообщение реги по данным из базы.
 * Если несколько человек записываются одновременно, обновления склеиваются в одно-два редактирования.
 */
export function refreshRaidMessage(client: Client, raidId: number): Promise<void> {
  const running = refreshing.get(raidId);
  if (running) {
    pending.add(raidId);
    return running;
  }
  const run = (async () => {
    do {
      pending.delete(raidId);
      await redraw(client, raidId);
    } while (pending.has(raidId));
    refreshing.delete(raidId);
  })();
  refreshing.set(raidId, run);
  return run;
}

async function redraw(client: Client, raidId: number): Promise<void> {
  const raid = getRaid(raidId);
  if (raid) requestBoardRefresh(client, raid.guildId); // запись, отмена, закрытие — список ближайших рейдов тоже
  if (!raid?.messageId) return;
  try {
    const channel = await client.channels.fetch(raid.channelId);
    if (!channel?.isTextBased() || channel.isDMBased()) return;
    const message = await channel.messages.fetch(raid.messageId);

    // Реги из прошлой версии бота сделаны «карточками» (Components V2), а такое сообщение
    // нельзя превратить в embed. Публикуем регу заново и удаляем старое сообщение.
    const image = getRaidImage(raid.id);
    if (message.flags.has(MessageFlags.IsComponentsV2)) {
      const fresh = await channel.send(buildRaidCreateMessage(raid, getSignups(raid.id), null, image));
      setRaidMessage(raid.id, fresh.id);
      await message.delete().catch(() => {});
      return;
    }

    await message.edit(buildRaidMessage(raid, getSignups(raid.id), image));
  } catch (error) {
    console.error(`Не удалось обновить сообщение реги #${raidId}:`, error);
  }
}

/** «🔥 Маг — Огонь» */
export function describeSignup(signup: Signup): string {
  const spec = specById.get(signup.specId);
  if (!spec) return 'неизвестный спек';
  return `${specEmoji(spec)} ${classById.get(spec.classId)?.name ?? ''} — ${spec.name}`;
}

const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  timeZone: settings.timeZone,
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** «чт, 15.10, 20:00» — для подсказок в командах (там нельзя использовать метки времени Discord). */
export function shortDate(ms: number): string {
  return dateFormat.format(new Date(ms));
}

/** Личное сообщение всем записавшимся. Закрытые личные сообщения просто пропускаем. */
export async function messageSignups(client: Client, raid: Raid, makeText: (signup: Signup) => string): Promise<void> {
  for (const signup of getSignups(raid.id)) {
    try {
      const user = await client.users.fetch(signup.userId);
      await user.send(makeText(signup));
    } catch {
      console.warn(`Не удалось написать в личку ${signup.userId} (рега #${raid.id}) — скорее всего, ЛС закрыты.`);
    }
  }
}

export function raidWhen(raid: Raid): string {
  const start = new Date(raid.startsAt);
  return `${time(start, TimestampStyles.RelativeTime)} (${time(start, TimestampStyles.FullDateShortTime)})`;
}
