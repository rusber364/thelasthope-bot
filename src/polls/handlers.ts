// Прохождение опроса:
//   «Пройти опрос» (в канале или в личке) → личная карточка прогресса → «Начать/Продолжить» → форма блока →
//   «Отправить» → карточка обновляется → … → «Готово!».
// Discord не разрешает открыть форму сразу после другой формы, поэтому между блоками — карточка с кнопкой.
// Анкету новичков бот присылает и в личку, поэтому кнопки работают и вне сервера: участника ищем на сервере опроса.
import { MessageFlags, type Attachment, type GuildMember, type MessageComponentInteraction, type ModalSubmitInteraction } from 'discord.js';
import type { ComponentHandler } from '../types.ts';
import { replyEphemeral } from '../lib/reply.ts';
import { LIMITS, emptyState, progressOf, type PollQuestion, type PollState } from './format.ts';
import { isOnboardingPoll, onOnboardingCompleted } from './onboarding.ts';
import { buildBlockModal, buildProgressCard } from './render.ts';
import { deletePollFiles, getPoll, getResponse, resetResponse, savePollFile, saveResponse, type StoredPoll } from './store.ts';

const EPHEMERAL_CARD = MessageFlags.Ephemeral | MessageFlags.IsComponentsV2;

/** Кнопка или форма опроса — на сервере или в личке. */
export type PollInteraction = MessageComponentInteraction | ModalSubmitInteraction;

/** Картинка-ответ: PNG, JPG, GIF или WEBP до 8 МБ. SVG нельзя — в нём может быть код, а админка показывает картинки у себя. */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export const MAX_ANSWER_IMAGE = 8 * 1024 * 1024;

export const pollHandler: ComponentHandler = { prefix: 'poll', handle: handlePollInteraction };

export async function handlePollInteraction(interaction: PollInteraction, [action, pollId, blockIndex]: string[]): Promise<void> {
  const poll = getPoll(Number(pollId));
  if (!poll) return replyEphemeral(interaction, 'Этот опрос не найден — возможно, его удалили.');
  if (poll.closed) return replyEphemeral(interaction, '🔒 Опрос закрыт, ответы больше не принимаются.');
  // В личке отвечать могут только те, кто сейчас на сервере опроса.
  if (!interaction.inGuild() && !(await memberOf(interaction, poll))) {
    return replyEphemeral(interaction, 'Этот опрос — для участников сервера гильдии. Зайди на сервер, и кнопка заработает.');
  }

  if (action === 'start') await start(interaction, poll);
  else if (action === 'next') await openNextBlock(interaction, poll);
  else if (action === 'submit' && interaction.isModalSubmit()) await submitBlock(interaction, poll, Number(blockIndex));
  else if (action === 'restart') await restart(interaction, poll);
}

/** Участник сервера опроса: на сервере — из взаимодействия, в личке — ищем по id. null — человека на сервере нет. */
async function memberOf(interaction: PollInteraction, poll: StoredPoll): Promise<GuildMember | null> {
  if (interaction.inCachedGuild()) return interaction.member;
  const guild = interaction.client.guilds.cache.get(poll.guildId);
  return (await guild?.members.fetch(interaction.user.id).catch(() => null)) ?? null;
}

/** Кнопка под опросом (или в приветствии): показываем личную карточку с прогрессом. */
async function start(interaction: PollInteraction, poll: StoredPoll): Promise<void> {
  const state = getResponse(poll.id, interaction.user.id)?.state ?? emptyState();
  await interaction.reply({ ...buildProgressCard(poll, state), flags: EPHEMERAL_CARD });
}

/** «Начать/Продолжить»: открываем форму следующего блока. */
async function openNextBlock(interaction: PollInteraction, poll: StoredPoll): Promise<void> {
  if (interaction.isModalSubmit()) return;
  const state = getResponse(poll.id, interaction.user.id)?.state ?? emptyState();
  const { done, total, next } = progressOf(poll.definition, state);
  if (next === undefined) {
    await interaction.update(buildProgressCard(poll, state));
    return;
  }
  await interaction.showModal(buildBlockModal(poll, next, done + 1, total));
}

/** Форма блока отправлена: сохраняем ответы и показываем, что дальше. */
async function submitBlock(interaction: ModalSubmitInteraction, poll: StoredPoll, blockIndex: number): Promise<void> {
  const block = poll.definition.blocks[blockIndex];
  if (!block) return;

  const previous = getResponse(poll.id, interaction.user.id);
  const state: PollState = previous?.state ?? emptyState();

  // Картинки нужно скачать, а ответить Discord ждёт за 3 секунды — поэтому сначала «бот думает…».
  const imageQuestions = block.questions.filter((question) => question.kind === 'image');
  if (imageQuestions.length) {
    if (interaction.isFromMessage()) await interaction.deferUpdate();
    else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }
  const showCard = async () => {
    const card = buildProgressCard(poll, state);
    if (interaction.deferred) await interaction.editReply({ ...card, flags: MessageFlags.IsComponentsV2 });
    else if (interaction.isFromMessage()) await interaction.update(card);
    else await interaction.reply({ ...card, flags: EPHEMERAL_CARD });
  };

  // Сначала проверяем и скачиваем все картинки: не подошла — страница не засчитана, её проходят ещё раз.
  const uploads = new Map<string, { file: Attachment; data: Uint8Array }>();
  for (const question of imageQuestions) {
    const file = uploadedImage(interaction, question);
    if (!file) continue;
    const problem = imageProblem(file);
    const data = problem ? null : await download(file.url);
    if (!data) {
      await showCard();
      await interaction.followUp({ content: problem ?? 'Не получилось сохранить картинку — отправь страницу ещё раз.', flags: MessageFlags.Ephemeral });
      return;
    }
    uploads.set(question.id, { file, data });
  }

  for (const question of block.questions) {
    if (question.kind !== 'image') {
      state.answers[question.id] = readAnswer(interaction, question);
      continue;
    }
    const upload = uploads.get(question.id);
    if (!upload) {
      deletePollFiles(poll.id, interaction.user.id, question.id);
      state.answers[question.id] = [];
      continue;
    }
    const fileId = savePollFile({
      pollId: poll.id,
      userId: interaction.user.id,
      questionId: question.id,
      name: upload.file.name,
      contentType: imageType(upload.file) ?? 'image/png',
      data: upload.data,
    });
    state.answers[question.id] = [String(fileId)];
  }
  if (!state.done.includes(blockIndex)) state.done.push(blockIndex);

  const finished = progressOf(poll.definition, state).next === undefined;
  saveResponse(poll.id, interaction.user.id, state, finished);
  await showCard();

  // Анкета новичков только что заполнена: роль и карточка офицерам — уже после ответа игроку.
  if (finished && !previous?.completedAt && isOnboardingPoll(poll)) {
    const member = await memberOf(interaction, poll);
    if (member) void onOnboardingCompleted(member, poll, state).catch((error) => console.error('Анкета новичка:', error));
  }
}

async function restart(interaction: PollInteraction, poll: StoredPoll): Promise<void> {
  if (!interaction.isButton()) return;
  resetResponse(poll.id, interaction.user.id);
  await interaction.update(buildProgressCard(poll, emptyState()));
}

/** Тип картинки без параметров («image/png; …» → «image/png»). */
const imageType = (file: { contentType: string | null }) => file.contentType?.split(';')[0]?.trim().toLowerCase() ?? null;

/** Почему картинка не подходит (текст для игрока) или null — подходит. */
export function imageProblem(file: { contentType: string | null; size: number }): string | null {
  const type = imageType(file);
  if (!type || !IMAGE_TYPES.includes(type)) return 'Нужна картинка: PNG, JPG, GIF или WEBP. Открой страницу ещё раз и загрузи другую.';
  if (file.size > MAX_ANSWER_IMAGE) return 'Картинка больше 8 МБ — уменьши её и загрузи ещё раз.';
  return null;
}

function uploadedImage(interaction: ModalSubmitInteraction, question: PollQuestion): Attachment | null {
  try {
    return interaction.fields.getUploadedFiles(question.id)?.first() ?? null;
  } catch {
    return null; // необязательный вопрос без картинки может вовсе не прийти в форме
  }
}

async function download(url: string): Promise<Uint8Array | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = new Uint8Array(await response.arrayBuffer());
    return data.length <= MAX_ANSWER_IMAGE ? data : null;
  } catch (error) {
    console.error('Опрос: не удалось скачать картинку-ответ:', error);
    return null;
  }
}

/** Достаём ответ на вопрос из формы. Неизвестные значения отбрасываем. */
function readAnswer(interaction: ModalSubmitInteraction, question: PollQuestion): string[] {
  const { fields } = interaction;
  const allowed = new Set(question.options.map((option) => option.value));
  const pick = (values: readonly (string | null)[]) => values.filter((v): v is string => v !== null && allowed.has(v));

  try {
    if (question.kind === 'single') {
      return question.options.length <= LIMITS.radioOptions
        ? pick([fields.getRadioGroup(question.id)])
        : pick(fields.getStringSelectValues(question.id).slice(0, 1));
    }
    if (question.kind === 'multiple') {
      return question.options.length <= LIMITS.checkboxOptions
        ? pick(fields.getCheckboxGroup(question.id))
        : pick(fields.getStringSelectValues(question.id));
    }
    const text = fields.getTextInputValue(question.id).trim();
    return text ? [text] : [];
  } catch {
    // Необязательный вопрос, на который не ответили, может вовсе не прийти в форме.
    return [];
  }
}
