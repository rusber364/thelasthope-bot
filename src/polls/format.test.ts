import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { emptyState, estimatedMinutes, parsePollFile, progressOf, questionCount } from './format.ts';
import { buildProgressCard } from './render.ts';

const example = readFileSync(new URL('../../examples/poll-example.txt', import.meta.url), 'utf8');

test('пример из examples/ разбирается без ошибок', () => {
  const result = parsePollFile(example);
  assert.ok(result.ok, result.ok ? '' : result.errors.join('\n'));
  const { poll } = result;
  assert.equal(poll.title, 'Warcraft Forever — формат гильдии');
  assert.equal(poll.blocks.length, 4);
  assert.equal(questionCount(poll), 14);
  assert.equal(estimatedMinutes(poll), 5);
  assert.equal(poll.anonymous, false);

  const activity = poll.blocks[0]!.questions[0]!;
  assert.equal(activity.title, 'Активность');
  assert.equal(activity.required, true);
  assert.equal(activity.kind, 'single');
  assert.equal(activity.hint, 'Насколько активно вы планируете играть в Warcraft Forever?');
  assert.deepEqual(activity.options[3], { value: 'o4', label: 'Хочу попробовать на старте', description: 'Дальше посмотрю' });

  assert.equal(poll.blocks[0]!.questions[1]!.kind, 'multiple');
  assert.equal(poll.blocks[3]!.questions[0]!.kind, 'short');
  assert.equal(poll.blocks[3]!.questions[3]!.kind, 'paragraph');
});

test('условия пропускают блоки для тех, кто не будет играть', () => {
  const result = parsePollFile(example);
  assert.ok(result.ok);
  const { poll } = result;
  const state = emptyState();

  assert.deepEqual(progressOf(poll, state), { done: 0, total: 4, next: 0 });

  state.answers.q1 = ['o6']; // «Скорее всего, не буду играть»
  state.done.push(0);
  assert.deepEqual(progressOf(poll, state), { done: 1, total: 2, next: 3 });

  state.answers.q1 = ['o1'];
  assert.deepEqual(progressOf(poll, state), { done: 1, total: 4, next: 1 });
});

test('понятные ошибки с номерами строк', () => {
  const result = parsePollFile(
    [
      '# Тест',
      '## Блок',
      'Если: Нет такого = Да',
      '### Вопрос без вариантов',
      '### Один вариант *',
      '( ) Единственный',
      '### Смешанный',
      '( ) А',
      '[ ] Б',
    ].join('\n'),
  );
  assert.equal(result.ok, false);
  const text = result.ok ? '' : result.errors.join('\n');
  assert.match(text, /Строка 9: в одном вопросе нельзя смешивать/);
  assert.match(text, /Строка 4: у вопроса «Вопрос без вариантов» нет вариантов/);
  assert.match(text, /Строка 5: .*минимум 2 варианта/);
  assert.match(text, /Строка 3: нет вопроса «Нет такого»/);
});

test('больше 5 вопросов в блоке — ошибка', () => {
  const questions = Array.from({ length: 6 }, (_, i) => `### В${i}\nОтвет: короткий`).join('\n');
  const result = parsePollFile(`# Тест\n## Блок\n${questions}`);
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.errors.join('\n'), /не больше 5 элементов/);
});

test('анкета новичка из examples/ разбирается, «Финал:» — текст после опроса', () => {
  const result = parsePollFile(readFileSync(new URL('../../examples/newbie-poll.txt', import.meta.url), 'utf8'));
  assert.ok(result.ok, result.ok ? '' : result.errors.join('\n'));
  const { poll } = result;
  assert.equal(poll.button, 'Пройти анкету');
  assert.equal(poll.blocks.length, 3);
  assert.equal(questionCount(poll), 12);
  assert.equal(poll.finish, 'Спасибо за ответы, друг! ⚡️\nДо встречи в совместных рейдах и других мероприятиях! ⚔️\nЗа Альянс и Азерот! ⚔️');

  const state = emptyState();
  state.done.push(0, 1, 2);
  const card = JSON.stringify(buildProgressCard({ id: 1, definition: poll } as never, state));
  assert.match(card, /Готово!\*\* Ответы сохранены\.\\n\\nСпасибо за ответы, друг!/);
});

test('без «Финал:» — обычное «Готово», слишком длинный финал — ошибка', () => {
  const plain = parsePollFile('# Т\n## Б\n### В\nОтвет: короткий');
  assert.ok(plain.ok);
  assert.equal(plain.poll.finish, undefined);
  const state = emptyState();
  state.done.push(0);
  assert.match(JSON.stringify(buildProgressCard({ id: 1, definition: plain.poll } as never, state)), /Готово! Спасибо — ответы сохранены/);

  const long = parsePollFile(`# Т\nФинал: ${'а'.repeat(1001)}\n## Б\n### В\nОтвет: короткий`);
  assert.equal(long.ok, false);
  assert.match(long.ok ? '' : long.errors.join('\n'), /«Финал:» длиннее 1000 символов/);
});
