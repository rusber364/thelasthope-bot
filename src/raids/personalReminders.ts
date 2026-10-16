// Личные напоминания (как в Raid-Helper Premium): кнопка «Напомнить» на реге — каждый сам выбирает,
// за сколько до начала написать ему в личку. Хранятся в базе, поэтому переживают перезапуск бота.
import { ActionRowBuilder, MessageFlags, StringSelectMenuBuilder, TimestampStyles, time, type Client } from 'discord.js';
import type { ComponentInteraction } from '../types.ts';
import { formatDuration } from '../lib/time.ts';
import { uiEmoji } from './emojis.ts';
import { raidUrl, raidWhen } from './service.ts';
import { duePersonalReminders, getPersonalReminder, getRaid, markPersonalReminderSent, setPersonalReminder, type Raid } from './store.ts';

export const REMINDER_CHOICES = [10, 30, 60, 120];
const MINUTE = 60_000;

/** «Напомнить» → меню с вариантами времени (видит только нажавший). */
export async function showReminderMenu(interaction: ComponentInteraction, raid: Raid): Promise<void> {
  const current = getPersonalReminder(raid.id, interaction.user.id);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`raid:remindset:${raid.id}`)
    .setPlaceholder('За сколько до начала напомнить?')
    .addOptions([
      ...REMINDER_CHOICES.map((minutes) => ({ label: `За ${formatDuration(minutes * MINUTE)}`, value: String(minutes), default: minutes === current })),
      ...(current ? [{ label: 'Не напоминать', value: '0' }] : []),
    ]);
  await interaction.reply({
    content: `${uiEmoji('countdown')} Напомню в личку о рейде **${raid.title}** (${raidWhen(raid)}).${current ? `\n-# Сейчас: за ${formatDuration(current * MINUTE)}.` : ''}`,
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
    flags: MessageFlags.Ephemeral,
  });
}

/** Выбор в меню: сохранить, поменять или убрать напоминание. */
export async function chooseReminder(interaction: ComponentInteraction, raid: Raid): Promise<void> {
  if (!interaction.isStringSelectMenu()) return;
  const minutes = Number(interaction.values[0]);
  if (!minutes) {
    setPersonalReminder(raid.id, interaction.user.id, null);
    await interaction.update({ content: '🔕 Напоминание отменено.', components: [] });
    return;
  }
  if (!REMINDER_CHOICES.includes(minutes)) return;
  const at = raid.startsAt - minutes * MINUTE;
  if (at <= Date.now()) {
    await interaction.update({ content: `До рейда уже меньше ${formatDuration(minutes * MINUTE)} — выбери время поменьше.` });
    return;
  }
  setPersonalReminder(raid.id, interaction.user.id, minutes);
  await interaction.update({
    content: `${uiEmoji('countdown')} Напомню в личку за ${formatDuration(minutes * MINUTE)} до начала — ${time(new Date(at), TimestampStyles.ShortTime)}. Отменить — снова «Напомнить».`,
    components: [],
  });
}

/** Каждые 30 секунд из планировщика: разослать напоминания, которым пора. */
export async function sendPersonalReminders(client: Client): Promise<void> {
  for (const { raidId, userId } of duePersonalReminders(Date.now())) {
    markPersonalReminderSent(raidId, userId); // сначала отмечаем: лучше пропустить, чем прислать дважды
    const raid = getRaid(raidId);
    if (!raid) continue;
    try {
      const user = await client.users.fetch(userId);
      await user.send(`${uiEmoji('countdown')} **Твоё напоминание:** рейд **${raid.title}** начнётся ${raidWhen(raid)}.\n[Открыть регу](${raidUrl(raid)})`);
    } catch {
      console.warn(`Не удалось написать в личку ${userId} (личное напоминание, рега #${raid.id}) — скорее всего, ЛС закрыты.`);
    }
  }
}
