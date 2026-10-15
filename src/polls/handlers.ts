// Прохождение опроса:
//   «Пройти опрос» (в канале) → личная карточка прогресса → «Начать/Продолжить» → форма блока →
//   «Отправить» → карточка обновляется → … → «Готово!».
// Discord не разрешает открыть форму сразу после другой формы, поэтому между блоками — карточка с кнопкой.
import { MessageFlags, type ModalSubmitInteraction } from 'discord.js';
import type { ComponentHandler, ComponentInteraction } from '../types.ts';
import { replyEphemeral } from '../lib/reply.ts';
import { LIMITS, emptyState, progressOf, type PollQuestion, type PollState } from './format.ts';
import { buildBlockModal, buildProgressCard } from './render.ts';
import { getPoll, getResponse, resetResponse, saveResponse, type StoredPoll } from './store.ts';

const EPHEMERAL_CARD = MessageFlags.Ephemeral | MessageFlags.IsComponentsV2;

export const pollHandler: ComponentHandler = {
  prefix: 'poll',
  async handle(interaction, [action, pollId, blockIndex]) {
    const poll = getPoll(Number(pollId));
    if (!poll) return replyEphemeral(interaction, 'Этот опрос не найден — возможно, его удалили.');
    if (poll.closed) return replyEphemeral(interaction, '🔒 Опрос закрыт, ответы больше не принимаются.');

    if (action === 'start') await start(interaction, poll);
    else if (action === 'next') await openNextBlock(interaction, poll);
    else if (action === 'submit' && interaction.isModalSubmit()) await submitBlock(interaction, poll, Number(blockIndex));
    else if (action === 'restart') await restart(interaction, poll);
  },
};

/** Кнопка под опросом в канале: показываем личную карточку с прогрессом. */
async function start(interaction: ComponentInteraction, poll: StoredPoll): Promise<void> {
  const state = getResponse(poll.id, interaction.user.id)?.state ?? emptyState();
  await interaction.reply({ ...buildProgressCard(poll, state), flags: EPHEMERAL_CARD });
}

/** «Начать/Продолжить»: открываем форму следующего блока. */
async function openNextBlock(interaction: ComponentInteraction, poll: StoredPoll): Promise<void> {
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
async function submitBlock(interaction: ModalSubmitInteraction<'cached'>, poll: StoredPoll, blockIndex: number): Promise<void> {
  const block = poll.definition.blocks[blockIndex];
  if (!block) return;

  const state: PollState = getResponse(poll.id, interaction.user.id)?.state ?? emptyState();
  for (const question of block.questions) {
    state.answers[question.id] = readAnswer(interaction, question);
  }
  if (!state.done.includes(blockIndex)) state.done.push(blockIndex);

  const finished = progressOf(poll.definition, state).next === undefined;
  saveResponse(poll.id, interaction.user.id, state, finished);

  const card = buildProgressCard(poll, state);
  if (interaction.isFromMessage()) await interaction.update(card);
  else await interaction.reply({ ...card, flags: EPHEMERAL_CARD });
}

async function restart(interaction: ComponentInteraction, poll: StoredPoll): Promise<void> {
  if (!interaction.isButton()) return;
  resetResponse(poll.id, interaction.user.id);
  await interaction.update(buildProgressCard(poll, emptyState()));
}

/** Достаём ответ на вопрос из формы. Неизвестные значения отбрасываем. */
function readAnswer(interaction: ModalSubmitInteraction<'cached'>, question: PollQuestion): string[] {
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
