import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.BOT_DB_PATH = ':memory:';
const { parsePollFile } = await import('./format.ts');
const { closeAndRedraw, pollStats, publishPoll } = await import('./service.ts');
const { getPoll, listPolls } = await import('./store.ts');

const SOURCE = `# Рейды осенью
Анонимный: нет

## Дни

### Какие дни удобны? *
[ ] Четверг
[ ] Пятница

### Пожелания
Ответ: длинный
`;
const parsed = parsePollFile(SOURCE);
assert.ok(parsed.ok);
const definition = parsed.poll;

const poll = (anonymous: boolean) => ({
  id: 1,
  guildId: 'g',
  channelId: 'c',
  messageId: null,
  definition: { ...definition, anonymous },
  createdBy: 'u',
  createdAt: 0,
  closed: false,
  source: SOURCE,
});
const response = (userId: string, answers: Record<string, string[]>, completed = true) => ({
  userId,
  state: { answers, done: [0] },
  completedAt: completed ? 1 : null,
  updatedAt: 1,
});
const responses = [
  response('u1', { q1: ['o1', 'o2'], q2: ['Пораньше бы'] }),
  response('u2', { q1: ['o2'] }),
  response('u3', {}, false),
];

test('итоги: проценты от ответивших, текстовые ответы с авторами', () => {
  const stats = pollStats(poll(false), responses);
  assert.equal(stats.total, 3);
  assert.equal(stats.completed, 2);
  const [days, wishes] = stats.questions;
  assert.equal(days!.answered, 2);
  assert.deepEqual(days!.options, [
    { label: 'Четверг', count: 1, percent: 50 },
    { label: 'Пятница', count: 2, percent: 100 },
  ]);
  assert.deepEqual(wishes!.texts, [{ userId: 'u1', text: 'Пораньше бы' }]);
  assert.equal(wishes!.block, 'Дни');
});

test('итоги анонимного опроса: текстовые ответы без авторов', () => {
  const stats = pollStats(poll(true), responses);
  assert.deepEqual(stats.questions[1]!.texts, [{ userId: null, text: 'Пораньше бы' }]);
});

// Подставной канал: запоминает отправленное и правки сообщения опроса.
const sent: { files: { name: string }[] }[] = [];
const edits: unknown[] = [];
let failSend = false;
const channel = {
  id: 'c',
  guildId: 'g',
  send: async (payload: { files: { name: string }[] }) => {
    if (failSend) throw new Error('Missing Permissions');
    sent.push(payload);
    return { id: 'm1', url: 'https://discord.com/channels/g/c/m1' };
  },
  messages: { fetch: async () => ({ attachments: new Map(), edit: async (payload: unknown) => void edits.push(payload) }) },
};
const guild = { channels: { cache: new Map([['c', { ...channel, isTextBased: () => true }]]) } };

test('публикация: картинка вложением, роль, исходный текст сохраняются', async () => {
  const { poll: stored, url } = await publishPoll(channel as never, definition, 'u', {
    image: { data: Buffer.from('png'), fileName: 'banner.PNG' },
    mentionRoleId: 'r1',
    source: SOURCE,
  });
  assert.equal(url, 'https://discord.com/channels/g/c/m1');
  assert.equal(sent[0]!.files[0]!.name, 'poll-image.PNG');
  const saved = getPoll(stored.id)!;
  assert.equal(saved.messageId, 'm1');
  assert.equal(saved.source, SOURCE);
  assert.equal(saved.definition.mentionRoleId, 'r1');
  assert.equal(saved.definition.image, 'attachment://poll-image.PNG');
  assert.equal(definition.image, undefined, 'исходное определение не меняется');
});

test('Discord не принял сообщение — опрос не остаётся в базе', async () => {
  const before = listPolls('g').length;
  failSend = true;
  await assert.rejects(publishPoll(channel as never, definition, 'u'));
  failSend = false;
  assert.equal(listPolls('g').length, before);
});

test('закрытие: опрос закрыт в базе, сообщение перерисовано', async () => {
  const stored = listPolls('g')[0]!;
  await closeAndRedraw(guild as never, stored);
  assert.equal(getPoll(stored.id)!.closed, true);
  assert.equal(edits.length, 1);
});

test('ответы по людям: только отвеченные вопросы, сначала дошедшие до конца, варианты — названиями', async () => {
  const { answersByUser } = await import('./service.ts');
  const people = answersByUser(poll(false), [
    { ...response('u3', {}, false), updatedAt: 5 },
    { ...response('u1', { q1: ['o1', 'o2'], q2: ['Пораньше бы'] }), updatedAt: 1 },
    { ...response('u2', { q1: ['o2'] }), updatedAt: 3 },
  ]);
  assert.deepEqual(people.map((p) => [p.userId, p.completed]), [['u2', true], ['u1', true], ['u3', false]]);
  assert.deepEqual(people[1]!.answers, [
    { block: 'Дни', question: 'Какие дни удобны?', answer: 'Четверг; Пятница' },
    { block: 'Дни', question: 'Пожелания', answer: 'Пораньше бы' },
  ]);
  assert.deepEqual(people[2]!.answers, []);
});

test('ответ-картинка: в форме — поле файла, в итогах и по людям — id картинки, в таблице — ссылка в админку', async () => {
  const { buildBlockModal, buildResultsCsv } = await import('./render.ts');
  const { answersByUser } = await import('./service.ts');
  const parsed = parsePollFile('# Анкета\n## Персонаж\n### Скриншот персонажа *\nОтвет: картинка');
  assert.ok(parsed.ok);
  const question = parsed.poll.blocks[0]!.questions[0]!;
  assert.equal(question.kind, 'image');

  const poll = { id: 5, definition: parsed.poll } as never;
  const upload = buildBlockModal(poll, 0, 1, 1).toJSON().components[0] as {
    component?: { type: number; max_values?: number; required?: boolean; file_types?: string[] };
  };
  assert.equal(upload.component?.type, 19, 'поле загрузки файла');
  assert.equal(upload.component?.max_values, 1);
  assert.equal(upload.component?.required, true);
  assert.deepEqual(upload.component?.file_types, ['image'], 'в окне выбора — только картинки');

  const responses = [{ userId: 'u1', state: { answers: { [question.id]: ['12'] }, done: [0] }, completedAt: 1, updatedAt: 1 }];
  assert.deepEqual(pollStats(poll, responses).questions[0]!.images, [{ userId: 'u1', fileId: 12 }]);
  assert.deepEqual(answersByUser(poll, responses)[0]!.answers, [{ block: 'Персонаж', question: 'Скриншот персонажа', answer: 'картинка', image: 12 }]);
  assert.match(buildResultsCsv(poll, responses, new Map()), /\/api\/polls\/5\/files\/12/);

  assert.equal(parsePollFile('# Т\n## Б\n### В\nОтвет: видео').ok, false, 'неизвестный вид ответа — ошибка');
});
