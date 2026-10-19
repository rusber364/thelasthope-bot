// Рега в личку при открытии: если в шаблоне включено, бот присылает открытую регу тем, кого она упоминает
// (роли «Упомянуть» шаблона). Рассылка идёт в фоне по одному сообщению в DM_PAUSE_MS — массовые личные сообщения
// без пауз Discord считает спамом. В каждом сообщении — «Не присылать мне»: отписка хранится в raid_dm_optout.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type ButtonInteraction, type Guild } from 'discord.js';
import { db } from '../db.ts';
import { uiEmoji } from './emojis.ts';
import { KINDS } from './kinds.ts';
import { raidUrl, raidWhen } from './service.ts';
import type { Raid } from './store.ts';

/** Пауза между личными сообщениями рассылки. */
export const DM_PAUSE_MS = 1500;
/** Префикс кнопок «Не присылать мне» / «Снова присылать»: raiddm:off|on:<сервер>:<канал реги>:<сообщение реги>. */
export const RAID_DM_PREFIX = 'raiddm';

const OFF_NOTE = '-# Больше не присылаю реги в личку. Передумаешь — «Снова присылать».';

export function isRaidDmOff(guildId: string, userId: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM raid_dm_optout WHERE guild_id = ? AND user_id = ?').get(guildId, userId));
}

export function setRaidDmOff(guildId: string, userId: string, off: boolean): void {
  if (off) db.prepare('INSERT OR IGNORE INTO raid_dm_optout (guild_id, user_id, at) VALUES (?, ?, ?)').run(guildId, userId, Date.now());
  else db.prepare('DELETE FROM raid_dm_optout WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
}

function optedOut(guildId: string): Set<string> {
  const rows = db.prepare('SELECT user_id FROM raid_dm_optout WHERE guild_id = ?').all(guildId) as { user_id: string }[];
  return new Set(rows.map((row) => row.user_id));
}

/** Кому слать: люди (не боты) хотя бы с одной из ролей, кроме отписавшихся (чистая функция). */
export function raidDmRecipients(members: { id: string; bot: boolean; roleIds: string[] }[], roleIds: string[], off: Set<string>): string[] {
  return members.filter((m) => !m.bot && !off.has(m.id) && m.roleIds.some((id) => roleIds.includes(id))).map((m) => m.id);
}

/** Где лежит рега: из этого собирается ссылка «Открыть регу», а сервер нужен для отписки. */
type RaidLink = Pick<Raid, 'guildId' | 'channelId' | 'messageId'>;

function buttons(raid: RaidLink, off: boolean) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(raidUrl(raid)).setLabel('Открыть регу'),
    new ButtonBuilder()
      .setStyle(ButtonStyle.Secondary)
      .setCustomId([RAID_DM_PREFIX, off ? 'on' : 'off', raid.guildId, raid.channelId, raid.messageId ?? ''].join(':'))
      .setLabel(off ? 'Снова присылать' : 'Не присылать мне'),
  );
}

/** Сообщение в личку об открытой реге. */
export function raidDmMessage(raid: Raid, guildName: string) {
  const kind = KINDS[raid.kind];
  return {
    content: `${uiEmoji('date')} **${guildName}**: открылась рега — ${kind.word} **${raid.title}** ${raidWhen(raid)}.\nЗапишись по кнопке в канале реги.`,
    components: [buttons(raid, false)],
  };
}

export interface RaidDmDeps {
  wait: (ms: number) => Promise<void>;
}

const DEFAULT_DEPS: RaidDmDeps = { wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };

let queue: Promise<void> = Promise.resolve();

/** Разослать регу в личку — в фоне и по очереди с другими рассылками, чтобы паузы соблюдались и между регами. */
export function sendRaidToDms(guild: Guild, raid: Raid, roleIds: string[], deps: RaidDmDeps = DEFAULT_DEPS): Promise<void> {
  queue = queue.then(() => run(guild, raid, roleIds, deps)).catch((error) => console.error(`Рассылка реги #${raid.id} в личку:`, error));
  return queue;
}

async function run(guild: Guild, raid: Raid, roleIds: string[], deps: RaidDmDeps): Promise<void> {
  if (!roleIds.length) return;
  const members = await guild.members.fetch();
  const list = [...members.values()].map((m) => ({ id: m.id, bot: m.user.bot, roleIds: [...m.roles.cache.keys()] }));
  const ids = raidDmRecipients(list, roleIds, optedOut(guild.id));
  const message = raidDmMessage(raid, guild.name);
  let sent = 0;
  for (const [index, userId] of ids.entries()) {
    if (index) await deps.wait(DM_PAUSE_MS);
    try {
      await members.get(userId)!.send(message);
      sent++;
    } catch {
      // закрыта личка или нет общего сервера — пропускаем
    }
  }
  const closed = ids.length - sent;
  console.log(`📨 Рега #${raid.id} «${raid.title}» в личку: ${sent} из ${ids.length}${closed ? `, не дошло ${closed} (закрыта личка)` : ''}.`);
}

/** «Не присылать мне» / «Снова присылать» в личном сообщении с регой. */
export async function handleRaidDmButton(interaction: ButtonInteraction, args: string[]): Promise<void> {
  const [action, guildId, channelId, messageId] = args;
  if ((action !== 'off' && action !== 'on') || !guildId || !channelId) return;
  const off = action === 'off';
  setRaidDmOff(guildId, interaction.user.id, off);
  const content = interaction.message.content.split(`\n${OFF_NOTE}`)[0]!;
  await interaction.update({
    content: off ? `${content}\n${OFF_NOTE}` : content,
    components: [buttons({ guildId, channelId, messageId: messageId || null }, off)],
  });
}
