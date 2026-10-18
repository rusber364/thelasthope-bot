// «Файл опроса» — обычный текстовый файл. Формат (подробно — в examples/poll-example.txt):
//
//   # Заголовок опроса
//   Текст под заголовком…
//   Картинка: https://…          (необязательно)
//   Анонимный: да | нет          (по умолчанию нет)
//   Кнопка: Пройти опрос         (необязательно)
//   Финал: Спасибо!              (текст после опроса; каждая строка «Финал:» — новая строка)
//
//   ## Название блока             ← одна страница = одна форма Discord (до 5 вопросов)
//   Если: Активность != Не буду играть   ← показывать блок только при таком ответе
//
//   ### Вопрос *                  ← «*» — обязательный
//   Пояснение к вопросу
//   ( ) Один из вариантов | подсказка под вариантом
//   [ ] Несколько вариантов
//   Ответ: короткий | длинный     ← ответ текстом

export type QuestionKind = 'single' | 'multiple' | 'short' | 'paragraph';

export interface PollOption {
  value: string;
  label: string;
  description?: string;
}

export interface PollQuestion {
  id: string;
  title: string;
  hint?: string;
  required: boolean;
  kind: QuestionKind;
  options: PollOption[];
}

export interface PollCondition {
  questionId: string;
  optionValue: string;
  negate: boolean;
}

export interface PollBlock {
  title: string;
  intro?: string;
  conditions: PollCondition[];
  questions: PollQuestion[];
}

export interface PollDefinition {
  title: string;
  description: string;
  /** Ссылка на картинку или attachment://имя, если картинку прикрепили к команде. */
  image?: string;
  anonymous: boolean;
  button: string;
  minutes?: number;
  /** Свой текст, который человек видит, когда прошёл опрос до конца. */
  finish?: string;
  mentionRoleId?: string;
  blocks: PollBlock[];
}

/** Ответы одного человека: id вопроса → выбранные значения (или текст одним элементом). */
export type PollAnswers = Record<string, string[]>;

export interface PollState {
  answers: PollAnswers;
  /** Номера пройденных блоков. */
  done: number[];
}

/** Ограничения Discord для форм. */
export const LIMITS = {
  title: 200,
  description: 3000,
  blocks: 25,
  componentsPerModal: 5,
  label: 45,
  hint: 100,
  option: 100,
  radioOptions: 10,
  checkboxOptions: 10,
  selectOptions: 25,
  button: 80,
  finish: 1000,
};

export type ParseResult = { ok: true; poll: PollDefinition } | { ok: false; errors: string[] };

interface DraftQuestion extends PollQuestion {
  line: number;
  kindLine?: number;
}

interface DraftCondition {
  line: number;
  questionTitle: string;
  optionLabel: string;
  negate: boolean;
}

interface DraftBlock {
  line: number;
  title: string;
  introLines: string[];
  conditions: DraftCondition[];
  questions: DraftQuestion[];
}

const normalize = (text: string) => text.trim().toLowerCase().replaceAll('ё', 'е').replace(/\s+/g, ' ');

export function parsePollFile(source: string): ParseResult {
  const errors: string[] = [];
  const error = (line: number, message: string) => errors.push(`Строка ${line}: ${message}`);

  let title: string | undefined;
  const descriptionLines: string[] = [];
  let image: string | undefined;
  let anonymous = false;
  let button = 'Пройти опрос';
  let minutes: number | undefined;
  const finishLines: string[] = [];

  const blocks: DraftBlock[] = [];
  let block: DraftBlock | undefined;
  let question: DraftQuestion | undefined;
  let questionCount = 0;

  const lines = source.replace(/^﻿/, '').split(/\r?\n/);
  lines.forEach((raw, index) => {
    const n = index + 1;
    const line = raw.trim();
    if (line.startsWith('//')) return;

    if (line.startsWith('### ')) {
      if (!block) return error(n, 'вопрос должен быть внутри блока — сначала строка «## Название блока».');
      let text = line.slice(4).trim();
      const required = text.endsWith('*');
      if (required) text = text.slice(0, -1).trim();
      if (!text) return error(n, 'у вопроса нет текста.');
      if (text.length > LIMITS.label) error(n, `вопрос длиннее ${LIMITS.label} символов (так ограничивает Discord). Перенеси детали в строку пояснения ниже.`);
      question = { id: `q${++questionCount}`, title: text, required, kind: 'short', options: [], line: n };
      block.questions.push(question);
      return;
    }

    if (line.startsWith('## ')) {
      block = { line: n, title: line.slice(3).trim(), introLines: [], conditions: [], questions: [] };
      question = undefined;
      if (!block.title) error(n, 'у блока нет названия.');
      blocks.push(block);
      return;
    }

    if (line.startsWith('# ')) {
      if (title !== undefined) return error(n, 'заголовок опроса («# …») может быть только один.');
      if (block) return error(n, 'заголовок опроса должен стоять в начале файла.');
      title = line.slice(2).trim();
      return;
    }

    if (!line) {
      if (!block) descriptionLines.push('');
      else if (!question) block.introLines.push('');
      return;
    }

    const option = /^(\(\s?\)|\[\s?\])\s*(.+)$/.exec(line);
    if (option) {
      if (!question) return error(n, 'вариант ответа должен идти после вопроса («### …»).');
      const kind: QuestionKind = option[1]!.startsWith('(') ? 'single' : 'multiple';
      if (question.kindLine !== undefined && question.kind !== kind) {
        return error(n, 'в одном вопросе нельзя смешивать «( )» и «[ ]».');
      }
      question.kind = kind;
      question.kindLine ??= n;
      const [label = '', description] = option[2]!.split('|').map((part) => part.trim());
      if (!label) return error(n, 'пустой вариант ответа.');
      if (label.length > LIMITS.option) error(n, `вариант длиннее ${LIMITS.option} символов.`);
      if (description && description.length > LIMITS.option) error(n, `подсказка к варианту длиннее ${LIMITS.option} символов.`);
      if (question.options.some((o) => normalize(o.label) === normalize(label))) error(n, `вариант «${label}» повторяется.`);
      question.options.push({ value: `o${question.options.length + 1}`, label, ...(description ? { description } : {}) });
      return;
    }

    const answer = /^ответ\s*:\s*(.+)$/i.exec(line);
    if (answer) {
      if (!question) return error(n, 'строка «Ответ:» должна идти после вопроса («### …»).');
      if (question.kindLine !== undefined) return error(n, 'у вопроса уже есть варианты ответа — строка «Ответ:» тут лишняя.');
      const value = normalize(answer[1]!);
      if (['короткий', 'строка', 'текст'].includes(value)) question.kind = 'short';
      else if (['длинный', 'абзац', 'большой'].includes(value)) question.kind = 'paragraph';
      else return error(n, 'после «Ответ:» напиши «короткий» или «длинный».');
      question.kindLine = n;
      return;
    }

    const condition = /^если\s*:\s*(.+?)\s*(!=|≠|=)\s*(.+)$/i.exec(line);
    if (condition) {
      if (!block || question) return error(n, 'строка «Если:» ставится сразу после названия блока, до вопросов.');
      block.conditions.push({ line: n, questionTitle: condition[1]!, optionLabel: condition[3]!, negate: condition[2] !== '=' });
      return;
    }

    if (!block) {
      const setting = /^(картинка|изображение|анонимный|анонимно|кнопка|время|финал)\s*:\s*(.*)$/i.exec(line);
      if (!setting) return void descriptionLines.push(line);
      const key = normalize(setting[1]!);
      const value = setting[2]!.trim();
      if (key === 'картинка' || key === 'изображение') {
        if (!/^https?:\/\/\S+$/.test(value)) return error(n, 'картинка должна быть ссылкой вида https://…');
        image = value;
      } else if (key === 'кнопка') {
        if (!value || value.length > LIMITS.button) return error(n, `текст кнопки должен быть от 1 до ${LIMITS.button} символов.`);
        button = value;
      } else if (key === 'финал') {
        finishLines.push(value);
      } else if (key === 'время') {
        const parsed = Number.parseInt(value, 10);
        if (!(parsed > 0)) return error(n, 'время укажи числом минут, например «Время: 5».');
        minutes = parsed;
      } else {
        const yes = ['да', 'yes', 'true', '1'].includes(normalize(value));
        const no = ['нет', 'no', 'false', '0'].includes(normalize(value));
        if (!yes && !no) return error(n, 'после «Анонимный:» напиши «да» или «нет».');
        anonymous = yes;
      }
      return;
    }

    if (question && question.kindLine === undefined) {
      question.hint = question.hint ? `${question.hint} ${line}` : line;
      return;
    }
    if (!question) {
      block.introLines.push(line);
      return;
    }
    error(n, `не понял строку «${line.slice(0, 40)}». Варианты начинаются с «( )» или «[ ]», текстовый ответ — «Ответ: короткий».`);
  });

  // Проверки всего файла целиком.
  if (!title) errors.push('Нет заголовка опроса: первой строкой напиши «# Название опроса».');
  else if (title.length > LIMITS.title) errors.push(`Заголовок длиннее ${LIMITS.title} символов.`);
  const description = descriptionLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (description.length > LIMITS.description) errors.push(`Текст под заголовком длиннее ${LIMITS.description} символов.`);
  const finish = finishLines.join('\n').trim();
  if (finish.length > LIMITS.finish) errors.push(`Текст «Финал:» длиннее ${LIMITS.finish} символов.`);
  if (!blocks.length) errors.push('В опросе нет ни одного блока: добавь строку «## Название блока» и вопросы под ней.');
  if (blocks.length > LIMITS.blocks) errors.push(`Блоков больше ${LIMITS.blocks}.`);

  const questionsByTitle = new Map<string, { question: DraftQuestion; blockIndex: number }[]>();
  blocks.forEach((b, blockIndex) => {
    for (const q of b.questions) {
      const key = normalize(q.title);
      questionsByTitle.set(key, [...(questionsByTitle.get(key) ?? []), { question: q, blockIndex }]);
    }
  });

  const result: PollBlock[] = blocks.map((b, blockIndex) => {
    const intro = b.introLines.join('\n').trim();
    if (!b.questions.length) error(b.line, `в блоке «${b.title}» нет вопросов.`);
    const used = b.questions.length + (intro ? 1 : 0);
    if (used > LIMITS.componentsPerModal) {
      error(b.line, `в блоке «${b.title}» ${b.questions.length} вопрос(ов)${intro ? ' и текст' : ''} — в одну форму Discord помещается не больше ${LIMITS.componentsPerModal} элементов. Раздели блок на два.`);
    }

    for (const q of b.questions) {
      if (q.kindLine === undefined) {
        error(q.line, `у вопроса «${q.title}» нет вариантов («( )» / «[ ]») и нет строки «Ответ: короткий».`);
      } else if (q.kind === 'single' && q.options.length < 2) {
        error(q.line, `в вопросе «${q.title}» с одним вариантом выбора нужно минимум 2 варианта.`);
      }
      if (q.options.length > LIMITS.selectOptions) error(q.line, `в вопросе «${q.title}» больше ${LIMITS.selectOptions} вариантов.`);
      if (q.hint && q.hint.length > LIMITS.hint) error(q.line, `пояснение к вопросу «${q.title}» длиннее ${LIMITS.hint} символов.`);
    }

    const conditions: PollCondition[] = [];
    for (const c of b.conditions) {
      const matches = questionsByTitle.get(normalize(c.questionTitle)) ?? [];
      if (matches.length !== 1) {
        error(c.line, matches.length ? `вопрос «${c.questionTitle}» встречается несколько раз — переименуй один.` : `нет вопроса «${c.questionTitle}».`);
        continue;
      }
      const { question: target, blockIndex: targetBlock } = matches[0]!;
      if (targetBlock >= blockIndex) {
        error(c.line, `условие может ссылаться только на вопросы из блоков выше.`);
        continue;
      }
      if (target.kind !== 'single' && target.kind !== 'multiple') {
        error(c.line, `условие можно ставить только на вопрос с вариантами.`);
        continue;
      }
      const option = target.options.find((o) => normalize(o.label) === normalize(c.optionLabel));
      if (!option) {
        error(c.line, `в вопросе «${target.title}» нет варианта «${c.optionLabel}».`);
        continue;
      }
      conditions.push({ questionId: target.id, optionValue: option.value, negate: c.negate });
    }

    return {
      title: b.title,
      ...(intro ? { intro } : {}),
      conditions,
      questions: b.questions.map(({ line: _line, kindLine: _kindLine, ...q }) => q),
    };
  });

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    poll: { title: title!, description, ...(image ? { image } : {}), anonymous, button, ...(minutes ? { minutes } : {}), ...(finish ? { finish } : {}), blocks: result },
  };
}

export function emptyState(): PollState {
  return { answers: {}, done: [] };
}

export function isBlockVisible(block: PollBlock, answers: PollAnswers): boolean {
  return block.conditions.every((condition) => {
    const chosen = answers[condition.questionId]?.includes(condition.optionValue) ?? false;
    return condition.negate ? !chosen : chosen;
  });
}

/** Сколько блоков уже пройдено, сколько всего (с учётом условий) и какой следующий. */
export function progressOf(poll: PollDefinition, state: PollState): { done: number; total: number; next: number | undefined } {
  const visible = poll.blocks.map((_, index) => index).filter((index) => isBlockVisible(poll.blocks[index]!, state.answers));
  return {
    done: visible.filter((index) => state.done.includes(index)).length,
    total: visible.length,
    next: visible.find((index) => !state.done.includes(index)),
  };
}

export function questionCount(poll: PollDefinition): number {
  return poll.blocks.reduce((sum, block) => sum + block.questions.length, 0);
}

/** Примерное время прохождения: ~20 секунд на вопрос. */
export function estimatedMinutes(poll: PollDefinition): number {
  return poll.minutes ?? Math.max(1, Math.round(questionCount(poll) / 3));
}
