// Анкета новичков — обычный опрос, отмеченный в настройках (onboarding.pollId). Кнопку «Пройти анкету» показывает
// приветствие, а предложить анкету тем, кто уже на сервере, можно обычной публикацией опроса в канале.
// Когда анкету заполнили до конца: выдать и снять роли из настроек и прислать офицерам карточку с ответами.
import { Colors, EmbedBuilder, type GuildMember } from 'discord.js';
import { getSettings, type Onboarding } from '../botSettings.ts';
import { sendAlert } from '../logs/alerts.ts';
import type { PollState } from './format.ts';
import { answersByUser } from './service.ts';
import type { StoredPoll } from './store.ts';

const REASON = 'Анкета новичка заполнена';
// Ограничения Discord для embed: 25 полей, 256 символов в названии поля, 1024 — в значении, 6000 — на всё.
const FIELDS = 25;
const FIELD_NAME = 256;
const FIELD_VALUE = 1024;
const EMBED_TOTAL = 5800;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export function isOnboardingPoll(poll: StoredPoll): boolean {
  return getSettings().onboarding.pollId === poll.id;
}

/** Анкету только что заполнили до конца. Ошибки не мешают игроку — только пишутся в консоль. */
export async function onOnboardingCompleted(member: GuildMember, poll: StoredPoll, state: PollState): Promise<void> {
  const { onboarding } = getSettings();
  if (onboarding.pollId !== poll.id) return;
  await updateRoles(member, onboarding);
  if (onboarding.notify) await sendAlert(member.guild, buildCompletedCard(member, poll, state));
}

async function updateRoles(member: GuildMember, { roleId, removeRoleId }: Onboarding): Promise<void> {
  const give = roleId ? member.guild.roles.cache.get(roleId) : undefined;
  if (give && !member.roles.cache.has(give.id)) {
    if (!give.editable) console.error(`Анкета: не могу выдать роль «${give.name}» — роль бота должна быть выше неё.`);
    else await member.roles.add(give, REASON).catch((error) => console.error(`Анкета: не удалось выдать роль «${give.name}»:`, error));
  }
  const take = removeRoleId ? member.guild.roles.cache.get(removeRoleId) : undefined;
  if (take && member.roles.cache.has(take.id)) {
    if (!take.editable) console.error(`Анкета: не могу снять роль «${take.name}» — роль бота должна быть выше неё.`);
    else await member.roles.remove(take, REASON).catch((error) => console.error(`Анкета: не удалось снять роль «${take.name}»:`, error));
  }
}

/** Карточка для офицеров: кто заполнил и ответы по вопросам (у анонимной анкеты — без ответов). */
export function buildCompletedCard(member: GuildMember, poll: StoredPoll, state: PollState): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(Colors.Green)
    .setTitle('📝 Анкета заполнена')
    .setDescription(`**Кто:** ${member} (${member.displayName})\n**Анкета:** #${poll.id} «${poll.definition.title}»`);
  if (poll.definition.anonymous) {
    return embed.setFooter({ text: 'Анкета анонимная — ответы видны только общей статистикой в админке.' });
  }

  const now = Date.now();
  const [person] = answersByUser(poll, [{ userId: member.id, state, completedAt: now, updatedAt: now }]);
  const answers = person?.answers ?? [];
  let total = (embed.data.title?.length ?? 0) + (embed.data.description?.length ?? 0);
  let shown = 0;
  for (const { question, answer } of answers) {
    const name = clip(question, FIELD_NAME);
    const value = clip(answer, FIELD_VALUE);
    if (shown === FIELDS - 1 || total + name.length + value.length > EMBED_TOTAL) break;
    embed.addFields({ name, value });
    total += name.length + value.length;
    shown++;
  }
  if (shown < answers.length) embed.addFields({ name: '…', value: `Ещё ответов: ${answers.length - shown} — в админке, «Опросы» → «По участникам».` });
  if (!answers.length) embed.addFields({ name: 'Ответы', value: 'Ни на один вопрос не ответили (все вопросы необязательные).' });
  return embed;
}
