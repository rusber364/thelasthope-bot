// Кнопки и меню на сообщении реги.
import { ActionRowBuilder, EmbedBuilder, MessageFlags, StringSelectMenuBuilder } from 'discord.js';
import type { ComponentHandler, ComponentInteraction } from '../types.ts';
import { getSettings } from '../botSettings.ts';
import { replyEphemeral } from '../lib/reply.ts';
import { formatDuration } from '../lib/time.ts';
import { sendAlert } from '../logs/alerts.ts';
import { LOG_COLORS } from '../logs/send.ts';
import { ROLES, classById, specById, specsOf, type RaidRole } from './classes.ts';
import { classEmoji, specComponentEmoji, uiEmoji } from './emojis.ts';
import { logRaidAction } from './actionLog.ts';
import { grantRaidRole, revokeRaidRole } from './tempRole.ts';
import { LIMIT_GROUPS, limitGroup } from './kinds.ts';
import { fullGroups, lineup, roleMentions, signupAccess, takenByGroup } from './lineup.ts';
import { chooseReminder, showReminderMenu } from './personalReminders.ts';
import { LATE_REMINDER_MS } from './scheduler.ts';
import { describeSignup, raidUrl, raidWhen, refreshRaidMessage } from './service.ts';
import { getRaid, getSignup, getSignups, removeSignup, setTentative, upsertSignup, type Raid, type Signup } from './store.ts';

export const raidHandler: ComponentHandler = {
  prefix: 'raid',
  async handle(interaction, [action, raidId]) {
    const raid = getRaid(Number(raidId));
    if (!raid) return replyEphemeral(interaction, 'Эта рега не найдена — возможно, её удалили.');
    if (raid.status === 'cancelled') return replyEphemeral(interaction, 'Этот рейд отменён.');
    if (raid.status === 'closed' || raid.startsAt <= Date.now()) {
      return replyEphemeral(interaction, 'Запись закрыта — рейд уже начался.');
    }

    if (action === 'class') await chooseClass(interaction, raid);
    else if (action === 'spec') await chooseSpec(interaction, raid);
    else if (action === 'maybe') await toggleMaybe(interaction, raid);
    else if (action === 'leave') await leave(interaction, raid);
    else if (action === 'remind') await showReminderMenu(interaction, raid);
    else if (action === 'remindset') await chooseReminder(interaction, raid);
  },
};

const HOUR = 60 * 60 * 1000;

/**
 * Какие напоминания в личку ещё впереди: «за сутки» и «за час» уходят всем, кто записан к этому моменту,
 * а кто записался позже (например, рега открылась за 53 минуты до рейда), получит своё за 15 минут до начала.
 */
export function reminderNote(msLeft: number): string {
  if (msLeft > 24 * HOUR) return 'Напомню в личные сообщения за сутки и за час до начала.';
  if (msLeft > HOUR) return 'Напомню в личные сообщения за час до начала.';
  if (msLeft > LATE_REMINDER_MS) return 'Напомню в личные сообщения за 15 минут до начала.';
  return 'До начала меньше 15 минут — напоминания в личку уже не будет.';
}

/** Почему запись в запасе: набрана роль по лимиту («Танки уже набраны (1/1)») или заполнена вся основа. */
export function benchReason(main: Signup[], raid: Pick<Raid, 'size' | 'limits'>, role: RaidRole): string {
  const group = limitGroup(role);
  const limit = raid.limits[group];
  const taken = takenByGroup(main)[group];
  if (limit !== null && taken >= limit) {
    const title = LIMIT_GROUPS.find((g) => g.group === group)!.title;
    return `${title} уже набраны (${taken}/${limit}), поэтому ты в запасе.`;
  }
  return 'Основной состав уже заполнен, поэтому ты в запасе.';
}

/** Куда этому участнику можно записаться — по его ролям и ролям реги из шаблона. */
const accessOf = (interaction: ComponentInteraction, raid: Raid) => signupAccess(new Set(interaction.member.roles.cache.keys()), raid);
const noAccess = (raid: Raid) => `Эта рега для ролей: ${roleMentions([...raid.mainRoleIds, ...raid.reserveRoleIds])}. Если роль нужна — спроси офицеров.`;

/** Шаг 1: выбрали класс в общем меню → показываем (только этому человеку) меню спеков. */
async function chooseClass(interaction: ComponentInteraction, raid: Raid): Promise<void> {
  if (!interaction.isStringSelectMenu()) return;
  const wowClass = classById.get(interaction.values[0] ?? '');
  if (!wowClass) return;
  const access = accessOf(interaction, raid);
  if (!access) return replyEphemeral(interaction, noAccess(raid));

  const current = getSignup(raid.id, interaction.user.id);
  const lines = [`${classEmoji(wowClass)} **${wowClass.name}** — выбери специализацию:`.trim()];
  if (current) lines.push(`-# Сейчас в списке: ${describeSignup(current)}. Новый выбор её заменит.`);
  if (access === 'reserve') lines.push('-# С твоими ролями в эту регу записывают только в запас.');

  // Роль, для которой места в основе по лимиту закончились, — с подписью: запись будет в запас.
  const full = fullGroups(getSignups(raid.id), raid.size, raid.limits, interaction.user.id);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`raid:spec:${raid.id}`)
    .setPlaceholder('Специализация')
    .addOptions(
      specsOf(wowClass.id).map((spec) => ({
        label: spec.name,
        value: spec.id,
        emoji: specComponentEmoji(spec),
        description: full.has(limitGroup(spec.role)) ? `${ROLES[spec.role].one} · мест нет — в запас` : ROLES[spec.role].one,
      })),
    );

  await interaction.reply({
    content: lines.join('\n'),
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
    flags: MessageFlags.Ephemeral,
  });
}

/** Шаг 2: выбрали спек → записываем и обновляем регу. */
async function chooseSpec(interaction: ComponentInteraction, raid: Raid): Promise<void> {
  if (!interaction.isStringSelectMenu()) return;
  const spec = specById.get(interaction.values[0] ?? '');
  if (!spec) return;

  // Роли могли поменяться, пока было открыто меню спеков, — проверяем ещё раз.
  const access = accessOf(interaction, raid);
  if (!access) {
    await interaction.update({ content: noAccess(raid), components: [], allowedMentions: { parse: [] } });
    return;
  }
  const before = getSignup(raid.id, interaction.user.id);
  upsertSignup(raid.id, interaction.user.id, spec.id, interaction.member.displayName, access === 'reserve');
  const signups = getSignups(raid.id);
  const signup = signups.find((s) => s.userId === interaction.user.id);
  const number = signups.findIndex((s) => s.userId === interaction.user.id) + 1;
  const { main, bench } = lineup(signups, raid.size, raid.limits);
  const onBench = bench.some((s) => s.userId === interaction.user.id);

  const lines = [`Записано: **${signup ? describeSignup(signup) : spec.name}**, твой номер в реге — \`${number}\`.`];
  if (signup?.tentative) lines.push('Сейчас стоит отметка «под вопросом» — сними её кнопкой на реге, если точно идёшь.');
  if (signup?.reserve) {
    lines.push(`${uiEmoji('bench')} Ты в запасе: в основной состав этой реги записываются ${roleMentions(raid.mainRoleIds)}.`);
  } else if (onBench) {
    lines.push(`${uiEmoji('bench')} ${benchReason(main, raid, spec.role)} Освободится место — поднимешься автоматически.`);
  }
  lines.push(`-# ${reminderNote(raid.startsAt - Date.now())}`);

  // Сначала отвечаем (на это есть 3 секунды), потом спокойно перерисовываем регу.
  await interaction.update({ content: lines.join('\n'), components: [], allowedMentions: { parse: [] } });
  await refreshRaidMessage(interaction.client, raid.id);
  await logRaidAction(interaction.guild, interaction.member, raid, before, signup ?? null);
  if (!before) await grantRaidRole(interaction.guild, interaction.user.id);
}

async function toggleMaybe(interaction: ComponentInteraction, raid: Raid): Promise<void> {
  const signup = getSignup(raid.id, interaction.user.id);
  if (!signup) {
    return replyEphemeral(interaction, 'Сначала выбери класс в меню записи — потом можно отметиться «под вопросом».');
  }
  setTentative(raid.id, interaction.user.id, !signup.tentative);
  await replyEphemeral(
    interaction,
    signup.tentative ? 'Отметка «под вопросом» снята — ты снова в основном списке.' : `${uiEmoji('tentative')} Отмечено: «под вопросом».`,
  );
  await refreshRaidMessage(interaction.client, raid.id);
  await logRaidAction(interaction.guild, interaction.member, raid, signup, { ...signup, tentative: !signup.tentative });
  if (!signup.tentative) await alertIfLate(interaction, raid, signup, 'Поздно отмечено «под вопросом»');
}

async function leave(interaction: ComponentInteraction, raid: Raid): Promise<void> {
  const signup = getSignup(raid.id, interaction.user.id);
  if (!signup || !removeSignup(raid.id, interaction.user.id)) {
    return replyEphemeral(interaction, 'Тебя и так нет в списке этой реги.');
  }
  await replyEphemeral(interaction, `${uiEmoji('leave')} Запись отменена.`);
  await refreshRaidMessage(interaction.client, raid.id);
  await logRaidAction(interaction.guild, interaction.member, raid, signup, null);
  await revokeRaidRole(interaction.guild, interaction.user.id, raid.id);
  await alertIfLate(interaction, raid, signup, 'Поздняя отписка от рейда');
}

/** Отписка или «под вопросом» незадолго до рейда — оповещение офицерам, чтобы успели найти замену. */
async function alertIfLate(interaction: ComponentInteraction, raid: Raid, signup: Signup, title: string): Promise<void> {
  const hours = getSettings().alerts.lateCancelHours;
  const left = raid.startsAt - Date.now();
  if (!hours || left <= 0 || left > hours * 60 * 60 * 1000) return;

  const embed = new EmbedBuilder()
    .setColor(LOG_COLORS.warn)
    .setTitle(title)
    .setDescription(
      [
        `**Кто:** ${interaction.member} · ${describeSignup(signup)}`,
        `**Рейд:** [${raid.title}](${raidUrl(raid)}) — ${raidWhen(raid)}`,
        `**До начала:** ${formatDuration(left)}`,
      ].join('\n'),
    );
  await sendAlert(interaction.guild, embed);
}
