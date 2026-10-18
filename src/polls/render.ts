// Как выглядят опросы: публичная карточка, личная карточка прогресса, формы-страницы и итоги.
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Colors,
  ContainerBuilder,
  LabelBuilder,
  ModalBuilder,
  TextDisplayBuilder,
  TextInputStyle,
  type MessageEditOptions,
} from 'discord.js';
import {
  LIMITS,
  estimatedMinutes,
  progressOf,
  questionCount,
  type PollDefinition,
  type PollQuestion,
  type PollState,
} from './format.ts';
import type { PollResponse, StoredPoll } from './store.ts';

const ACCENT = 0xf0b232; // жёлтая полоска, как на скриншоте

/** Сообщение в канале: текст, картинка и кнопка «Пройти опрос». */
export function buildPublicMessage(poll: StoredPoll) {
  const def = poll.definition;
  const components: (TextDisplayBuilder | ContainerBuilder | ActionRowBuilder<ButtonBuilder>)[] = [];

  if (def.mentionRoleId) components.push(new TextDisplayBuilder().setContent(`<@&${def.mentionRoleId}>`));

  const card = new ContainerBuilder().setAccentColor(ACCENT);
  card.addTextDisplayComponents((text) => text.setContent([`## ${def.title}`, def.description].filter(Boolean).join('\n')));
  if (def.image) {
    const url = def.image;
    card.addMediaGalleryComponents((gallery) => gallery.addItems((item) => item.setURL(url)));
  }
  if (poll.closed) card.addTextDisplayComponents((text) => text.setContent('**🔒 Опрос закрыт. Спасибо всем, кто ответил!**'));
  components.push(card);

  components.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`poll:start:${poll.id}`)
        .setStyle(poll.closed ? ButtonStyle.Secondary : ButtonStyle.Primary)
        .setLabel(poll.closed ? 'Опрос закрыт' : def.button)
        .setDisabled(poll.closed),
    ),
  );

  // Роль пингуем только при публикации, при редактировании — никого.
  return {
    components,
    allowedMentions: def.mentionRoleId && !poll.closed ? { roles: [def.mentionRoleId] } : { parse: [] },
  } satisfies MessageEditOptions;
}

function anonymityNote(def: PollDefinition): string {
  return def.anonymous
    ? 'Опрос анонимный: офицеры увидят только общую статистику.'
    : 'Опрос не анонимный, ответы будут видны офицерам сервера.';
}

function progressBar(done: number, total: number): string {
  return '▰'.repeat(done) + '▱'.repeat(Math.max(0, total - done));
}

/** Личная карточка (её видит только проходящий): сколько пройдено и кнопка «Продолжить». */
export function buildProgressCard(poll: StoredPoll, state: PollState) {
  const def = poll.definition;
  const { done, total, next } = progressOf(def, state);
  const finished = next === undefined;

  const card = new ContainerBuilder()
    .setAccentColor(finished ? Colors.Green : ACCENT)
    .addTextDisplayComponents((text) => text.setContent(`## ${def.title}`))
    .addTextDisplayComponents((text) =>
      text.setContent(`-# Вопросов: до ${questionCount(def)} · примерно ${estimatedMinutes(def)} мин.\n-# ${anonymityNote(def)}`),
    );

  if (finished) {
    // Свой текст из строк «Финал:» — после отметки, что ответы сохранены.
    const done = def.finish ? `✅ **Готово!** Ответы сохранены.\n\n${def.finish}` : '✅ **Готово! Спасибо — ответы сохранены.**';
    card.addTextDisplayComponents((text) => text.setContent(done));
  } else {
    card.addTextDisplayComponents((text) =>
      text.setContent(`⏳ Пройдено ${done} из ${total} ${progressBar(done, total)} — дальше блок «${def.blocks[next]!.title}».`),
    );
  }

  card.addSeparatorComponents((separator) => separator);
  card.addActionRowComponents((row) =>
    row.addComponents(
      finished
        ? new ButtonBuilder().setCustomId(`poll:restart:${poll.id}`).setStyle(ButtonStyle.Secondary).setLabel('Пройти заново')
        : new ButtonBuilder()
            .setCustomId(`poll:next:${poll.id}`)
            .setStyle(ButtonStyle.Primary)
            .setLabel(done === 0 ? 'Начать' : 'Продолжить'),
    ),
  );

  return { components: [card] };
}

/** Одна страница опроса — форма Discord с вопросами блока. */
export function buildBlockModal(poll: StoredPoll, blockIndex: number, position: number, total: number): ModalBuilder {
  const block = poll.definition.blocks[blockIndex]!;
  const suffix = ` (${position}/${total})`;
  const modal = new ModalBuilder()
    .setCustomId(`poll:submit:${poll.id}:${blockIndex}`)
    .setTitle(block.title.slice(0, 45 - suffix.length) + suffix);

  if (block.intro) modal.addTextDisplayComponents((text) => text.setContent(block.intro!));
  modal.addLabelComponents(block.questions.map(buildQuestion));
  return modal;
}

/**
 * Бот сам выбирает подходящий элемент формы:
 * до 10 вариантов — кружочки или галочки, больше — выпадающий список, текст — поле ввода.
 */
function buildQuestion(question: PollQuestion): LabelBuilder {
  const label = new LabelBuilder().setLabel(question.title);
  if (question.hint) label.setDescription(question.hint);

  const options = question.options.map((o) => ({
    label: o.label,
    value: o.value,
    ...(o.description ? { description: o.description } : {}),
  }));
  const minValues = question.required ? 1 : 0;

  if (question.kind === 'single' && options.length <= LIMITS.radioOptions) {
    return label.setRadioGroupComponent((radio) => radio.setCustomId(question.id).setRequired(question.required).addOptions(options));
  }
  if (question.kind === 'multiple' && options.length <= LIMITS.checkboxOptions) {
    return label.setCheckboxGroupComponent((group) =>
      group.setCustomId(question.id).setRequired(question.required).setMinValues(minValues).setMaxValues(options.length).addOptions(options),
    );
  }
  if (question.kind === 'single' || question.kind === 'multiple') {
    return label.setStringSelectMenuComponent((select) =>
      select
        .setCustomId(question.id)
        .setRequired(question.required)
        .setPlaceholder('Выберите нужное')
        .setMinValues(minValues)
        .setMaxValues(question.kind === 'single' ? 1 : options.length)
        .addOptions(options),
    );
  }
  return label.setTextInputComponent((input) =>
    input
      .setCustomId(question.id)
      .setStyle(question.kind === 'short' ? TextInputStyle.Short : TextInputStyle.Paragraph)
      .setRequired(question.required)
      .setMaxLength(question.kind === 'short' ? 200 : 2000),
  );
}

/** Итоги для офицеров: проценты по каждому варианту. */
export function buildResultsText(poll: StoredPoll, responses: PollResponse[]): string {
  const def = poll.definition;
  const completed = responses.filter((r) => r.completedAt).length;
  const lines = [`Завершили: **${completed}** · начали, но не закончили: **${responses.length - completed}**`];

  for (const block of def.blocks) {
    lines.push('', `__**${block.title}**__`);
    for (const question of block.questions) {
      const answered = responses.filter((r) => (r.state.answers[question.id]?.length ?? 0) > 0);
      if (question.kind === 'short' || question.kind === 'paragraph') {
        lines.push(`**${question.title}** — ответов: ${answered.length} (сами ответы — в файле)`);
        continue;
      }
      lines.push(`**${question.title}** — ответили: ${answered.length}`);
      for (const option of question.options) {
        const count = answered.filter((r) => r.state.answers[question.id]!.includes(option.value)).length;
        const percent = answered.length ? Math.round((count / answered.length) * 100) : 0;
        const filled = Math.round(percent / 10);
        lines.push(`\`${'█'.repeat(filled)}${'░'.repeat(10 - filled)}\` ${percent}% · ${count} — ${option.label}`);
      }
    }
  }

  const text = lines.join('\n');
  return text.length <= 4000 ? text : `${text.slice(0, 3900)}\n…\n**Не поместилось — полные итоги в файле.**`;
}

/** Таблица для Excel/Google Таблиц: одна строка — один участник. */
export function buildResultsCsv(poll: StoredPoll, responses: PollResponse[], names: Map<string, string>): string {
  const def = poll.definition;
  const questions = def.blocks.flatMap((block) => block.questions);
  const header = [...(def.anonymous ? [] : ['Участник', 'ID']), 'Статус', ...questions.map((q) => q.title)];

  const rows = responses.map((response) => [
    ...(def.anonymous ? [] : [names.get(response.userId) ?? '', response.userId]),
    response.completedAt ? 'завершён' : 'не закончен',
    ...questions.map((q) => {
      const values = response.state.answers[q.id] ?? [];
      if (q.kind === 'short' || q.kind === 'paragraph') return values[0] ?? '';
      return values.map((value) => q.options.find((o) => o.value === value)?.label ?? value).join('; ');
    }),
  ]);
  // В анонимном опросе перемешиваем строки, чтобы по порядку нельзя было угадать, кто отвечал.
  if (def.anonymous) {
    for (let i = rows.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rows[i], rows[j]] = [rows[j]!, rows[i]!];
    }
  }

  const escape = (cell: string) => `"${cell.replaceAll('"', '""')}"`;
  // «;» и BOM — чтобы Excel с русскими настройками сразу открыл файл по столбцам и без кракозябр.
  return '﻿' + [header, ...rows].map((row) => row.map(escape).join(';')).join('\r\n');
}
