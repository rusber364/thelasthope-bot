// Кнопки и меню на сообщении реги.
import { ActionRowBuilder, MessageFlags, StringSelectMenuBuilder } from 'discord.js';
import type { ComponentHandler, ComponentInteraction } from '../types.ts';
import { replyEphemeral } from '../lib/reply.ts';
import { ROLES, classById, specById, specsOf } from './classes.ts';
import { classEmoji, specComponentEmoji, uiEmoji } from './emojis.ts';
import { describeSignup, refreshRaidMessage } from './service.ts';
import { getRaid, getSignup, getSignups, removeSignup, setTentative, upsertSignup, type Raid } from './store.ts';

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
  },
};

/** Шаг 1: выбрали класс в общем меню → показываем (только этому человеку) меню спеков. */
async function chooseClass(interaction: ComponentInteraction, raid: Raid): Promise<void> {
  if (!interaction.isStringSelectMenu()) return;
  const wowClass = classById.get(interaction.values[0] ?? '');
  if (!wowClass) return;

  const current = getSignup(raid.id, interaction.user.id);
  const lines = [`${classEmoji(wowClass)} **${wowClass.name}** — выбери специализацию:`.trim()];
  if (current) lines.push(`-# Сейчас в списке: ${describeSignup(current)}. Новый выбор её заменит.`);

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`raid:spec:${raid.id}`)
    .setPlaceholder('Специализация')
    .addOptions(
      specsOf(wowClass.id).map((spec) => ({
        label: spec.name,
        value: spec.id,
        emoji: specComponentEmoji(spec),
        description: ROLES[spec.role].one,
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

  upsertSignup(raid.id, interaction.user.id, spec.id, interaction.member.displayName);
  const signups = getSignups(raid.id);
  const signup = signups.find((s) => s.userId === interaction.user.id);
  const number = signups.findIndex((s) => s.userId === interaction.user.id) + 1;
  const confirmed = signups.filter((s) => !s.tentative);
  const onBench = confirmed.findIndex((s) => s.userId === interaction.user.id) >= raid.size;

  const lines = [`Записано: **${signup ? describeSignup(signup) : spec.name}**, твой номер в реге — \`${number}\`.`];
  if (signup?.tentative) lines.push('Сейчас стоит отметка «под вопросом» — сними её кнопкой на реге, если точно идёшь.');
  if (onBench) {
    lines.push(`${uiEmoji('bench')} Основной состав уже заполнен, поэтому ты в запасе. Освободится место — поднимешься автоматически.`);
  }
  lines.push('-# Напомню в личные сообщения за сутки и за час до начала.');

  // Сначала отвечаем (на это есть 3 секунды), потом спокойно перерисовываем регу.
  await interaction.update({ content: lines.join('\n'), components: [] });
  await refreshRaidMessage(interaction.client, raid.id);
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
}

async function leave(interaction: ComponentInteraction, raid: Raid): Promise<void> {
  if (!removeSignup(raid.id, interaction.user.id)) {
    return replyEphemeral(interaction, 'Тебя и так нет в списке этой реги.');
  }
  await replyEphemeral(interaction, `${uiEmoji('leave')} Запись отменена.`);
  await refreshRaidMessage(interaction.client, raid.id);
}
