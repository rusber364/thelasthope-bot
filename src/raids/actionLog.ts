// «лог-рейдов»: каждое действие игрока с регой — запись, смена спека, «под вопросом», отписка.
import { EmbedBuilder, type Guild, type GuildMember } from 'discord.js';
import { LOG_COLORS, sendLog } from '../logs/send.ts';
import { KINDS, type ActivityKind } from './kinds.ts';
import { describeSignup, raidUrl, raidWhen } from './service.ts';
import type { Raid, Signup } from './store.ts';

export interface RaidActionEntry {
  title: string;
  color: number;
  /** Строка «что изменилось». */
  change: string;
}

/**
 * Что произошло между двумя состояниями записи одного игрока. null — ничего не изменилось
 * (например, тот же спек выбран повторно): такие действия не логируются, чтобы не было дублей.
 */
export function raidActionEntry(before: Signup | null, after: Signup | null, kind: ActivityKind = 'raid'): RaidActionEntry | null {
  if (!before && after) return { title: `Запись ${KINDS[kind].to}`, color: LOG_COLORS.create, change: describeSignup(after) };
  if (before && !after) return { title: `Отписка ${KINDS[kind].from}`, color: LOG_COLORS.delete, change: describeSignup(before) };
  if (!before || !after) return null;

  if (before.specId !== after.specId) {
    return { title: 'Смена специализации', color: LOG_COLORS.update, change: `${describeSignup(before)} → ${describeSignup(after)}` };
  }
  if (before.tentative !== after.tentative) {
    return after.tentative
      ? { title: 'Отметка «под вопросом»', color: LOG_COLORS.warn, change: describeSignup(after) }
      : { title: 'Снова в основном списке', color: LOG_COLORS.create, change: describeSignup(after) };
  }
  return null;
}

export async function logRaidAction(guild: Guild, member: GuildMember, raid: Raid, before: Signup | null, after: Signup | null): Promise<void> {
  const entry = raidActionEntry(before, after, raid.kind);
  if (!entry) return;
  const embed = new EmbedBuilder()
    .setColor(entry.color)
    .setTitle(entry.title)
    .setDescription(
      [`**Кто:** ${member} · ${member.displayName}`, `**${KINDS[raid.kind].title}:** [${raid.title}](${raidUrl(raid)}) — ${raidWhen(raid)}`, `**Что:** ${entry.change}`].join('\n'),
    )
    .setFooter({ text: `Рега #${raid.id}` });
  await sendLog(guild, 'raids', embed);
}
