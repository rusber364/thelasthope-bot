import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mock, test } from 'node:test';
import { Collection, Events } from 'discord.js';

process.env.BOT_DB_PATH = ':memory:';
const { applyText, buildPrompt, newDraft, raidWizardHandler, registerRaidWizard, startRaidWizard } = await import('./wizard.ts');
const { getDraft } = await import('./drafts.ts');
const { getRaid, getRaidImage } = await import('./store.ts');

const kyiv = (date: string, time: string) =>
  Temporal.PlainDate.from(date).toZonedDateTime({ timeZone: 'Europe/Kyiv', plainTime: Temporal.PlainTime.from(time) }).epochMilliseconds;
const draftAt = (step: Parameters<typeof applyText>[0]['step'], extra = {}) => ({
  ...newDraft({ userId: 'u', guildId: 'g', channelId: 'c', pingRoleId: null, size: 40, leaderName: 'Офицер' }),
  step,
  ...extra,
});
const tomorrow = () => Temporal.Now.plainDateISO('Europe/Kyiv').add({ days: 1 }).toString();

test('шаги: проверка ответов и порядок', () => {
  assert.deepEqual(applyText(draftAt('title'), '   '), { ok: false, error: 'Название не может быть пустым.' });
  assert.match((applyText(draftAt('title'), 'x'.repeat(101)) as { error: string }).error, /не длиннее 100/);

  const titled = applyText(draftAt('title'), ' Огненные Недра ');
  assert.ok(titled.ok);
  assert.equal(titled.draft.title, 'Огненные Недра');
  assert.equal(titled.draft.step, 'description');

  assert.match((applyText(draftAt('date'), 'вчера') as { error: string }).error, /Не понял дату/);
  assert.match((applyText(draftAt('date'), '01.01.2020') as { error: string }).error, /уже прошла/);
  const dated = applyText(draftAt('date'), 'завтра');
  assert.ok(dated.ok && dated.draft.date === tomorrow() && dated.draft.step === 'time');

  const today = Temporal.Now.plainDateISO('Europe/Kyiv').toString();
  const noon = kyiv(today, '12:00');
  assert.match((applyText(draftAt('time', { date: today }), '11:00', noon) as { error: string }).error, /уже прошло/);
  assert.ok(applyText(draftAt('time', { date: today }), '13:00', noon).ok);
  assert.match((applyText(draftAt('time', { date: tomorrow() }), '25:00') as { error: string }).error, /Не понял время/);
  const timed = applyText(draftAt('time', { date: tomorrow() }), '9.30');
  assert.ok(timed.ok && timed.draft.time === '09:30' && timed.draft.step === 'image');

  // После предпросмотра правка любого шага возвращает к предпросмотру.
  const edited = applyText(draftAt('title', { editing: true, title: 'Старое' }), 'Новое');
  assert.ok(edited.ok && edited.draft.step === 'confirm' && edited.draft.title === 'Новое');
  assert.match((applyText(draftAt('image'), 'вот') as { error: string }).error, /Пришли картинку/);
});

test('кнопки шагов: ближайшие дни, время, «Назад» и предпросмотр с публикацией', () => {
  type Row = { toJSON(): { components: { custom_id?: string }[] } };
  const ids = (prompt: ReturnType<typeof buildPrompt>) =>
    (prompt.components ?? []).flatMap((row) => (row as Row).toJSON().components.map((c) => c.custom_id ?? ''));

  assert.deepEqual(ids(buildPrompt(draftAt('title'))), ['rwiz:cancel'], 'на первом шаге нет «Назад»');
  const dateIds = ids(buildPrompt(draftAt('date')));
  assert.equal(dateIds.filter((id) => id.startsWith('rwiz:date:')).length, 5);
  assert.ok(dateIds.includes(`rwiz:date:${tomorrow()}`));
  assert.ok(dateIds.includes('rwiz:back'));
  assert.ok(ids(buildPrompt(draftAt('time'))).includes('rwiz:time:20:00'));
  assert.ok(ids(buildPrompt(draftAt('description', { editing: true }))).includes('rwiz:preview'));

  const preview = buildPrompt(draftAt('confirm', { title: 'Огненные Недра', date: tomorrow(), time: '20:00', editing: true }));
  assert.deepEqual(ids(preview), ['rwiz:publish', 'rwiz:cancel', 'rwiz:edit']);
  assert.match(String(preview.content), /Предпросмотр/);
});

// --- Сквозной сценарий в личке: подставной офицер, сервер и канал реги ---

const sent: { id: string; payload: Record<string, unknown> }[] = [];
const replies: string[] = [];
const stripped: string[] = [];
let dmClosed = false;
const user = {
  id: 'officer',
  bot: false,
  dmChannel: { messages: { edit: async (id: string) => void stripped.push(id) } },
  createDM: async () => user.dmChannel,
  send: async (payload: Record<string, unknown>) => {
    if (dmClosed) throw Object.assign(new Error('Cannot send messages to this user'), { code: 50007 });
    const id = `dm${sent.length + 1}`;
    sent.push({ id, payload });
    return { id, url: `https://discord.com/channels/@me/1/${id}` };
  },
};
const posted: Record<string, unknown>[] = [];
const raidChannel = {
  id: 'c',
  name: 'рега',
  guild: { id: 'g' },
  isTextBased: () => true,
  isDMBased: () => false,
  permissionsFor: () => ({ has: () => true }),
  send: async (payload: Record<string, unknown>) => {
    posted.push(payload);
    return { id: 'raid-message' };
  },
};
const guild = {
  id: 'g',
  channels: { cache: new Map([['c', raidChannel]]) },
  members: { me: {}, fetch: async (id: string) => ({ id, displayName: 'Офицер', permissions: { has: () => true } }) },
};
const client = new EventEmitter();
registerRaidWizard(client as never);

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
};
const say = async (content: string, attachments: [string, Record<string, unknown>][] = []) => {
  client.emit(Events.MessageCreate, {
    inGuild: () => false,
    author: user,
    content,
    attachments: new Collection(attachments),
    reply: async (text: string) => void replies.push(text),
  });
  await settle();
};
const press = async (customId: string, values: string[] = []) => {
  const log: { kind: string; payload?: unknown }[] = [];
  const interaction = {
    user,
    message: { id: sent.at(-1)!.id },
    client: { guilds: { cache: new Map([['g', guild]]) } },
    isStringSelectMenu: () => values.length > 0,
    values,
    update: async (payload: unknown) => void log.push({ kind: 'update', payload }),
    reply: async (payload: unknown) => void log.push({ kind: 'reply', payload }),
    deferUpdate: async () => void log.push({ kind: 'defer' }),
    editReply: async (payload: unknown) => void log.push({ kind: 'editReply', payload }),
    followUp: async (payload: unknown) => void log.push({ kind: 'followUp', payload }),
  };
  const [, ...args] = customId.split(':');
  await raidWizardHandler.handle(interaction as never, args);
  return log;
};
const title = (i: number) => (sent[i]!.payload.embeds as { data: { title: string } }[] | undefined)?.[0]?.data.title ?? '';

test('личка закрыта — понятный отказ, черновик не остаётся', async () => {
  dmClosed = true;
  const result = await startRaidWizard(user as never, { userId: user.id, guildId: 'g', channelId: 'c', pingRoleId: null, size: 25, leaderName: 'Офицер' });
  dmClosed = false;
  assert.deepEqual(result, { ok: false });
  assert.equal(getDraft(user.id), null);
});

test('по шагам в личке: название → описание → дата → время → картинка → предпросмотр → публикация', async () => {
  const started = await startRaidWizard(user as never, { userId: user.id, guildId: 'g', channelId: 'c', pingRoleId: 'R', size: 25, leaderName: 'Офицер' });
  assert.ok(started.ok);
  assert.match(title(0), /шаг 1 из 5 — Название/);

  await say('Огненные Недра');
  assert.match(title(1), /шаг 2 из 5 — Описание/);
  assert.deepEqual(stripped, ['dm1'], 'у прошлого шага убраны кнопки');

  // «Назад» и снова вперёд.
  await press('rwiz:back');
  assert.match(title(2), /шаг 1 из 5/);
  await say('Огненные Недра');
  await say('Сбор в 19:45 у входа');
  assert.match(title(4), /шаг 3 из 5 — Дата/);

  await say('вчера');
  assert.match(replies.at(-1)!, /Не понял дату/);
  await press(`rwiz:date:${tomorrow()}`);
  assert.match(title(5), /шаг 4 из 5 — Время/);
  await say('20:00');
  assert.match(title(6), /шаг 5 из 5 — Картинка/);

  const fetchMock = mock.method(globalThis, 'fetch', async () => new Response(new Uint8Array([137, 80, 78, 71])));
  try {
    await say('', [['a1', { name: 'Фон.PNG', contentType: 'image/png', size: 4, url: 'https://cdn.discordapp.com/x.png' }]]);
  } finally {
    fetchMock.mock.restore();
  }
  const preview = sent.at(-1)!.payload;
  assert.match(String(preview.content), /Предпросмотр/);
  assert.equal((preview.files as unknown[]).length, 1, 'своя картинка в предпросмотре');

  // Правка из предпросмотра возвращает к нему же.
  await press('rwiz:edit', ['title']);
  assert.match(title(sent.length - 1), /Название/);
  await say('Огненные Недра (героик)');
  assert.match(String(sent.at(-1)!.payload.content), /Предпросмотр/);

  const log = await press('rwiz:publish');
  assert.deepEqual(log.map((entry) => entry.kind), ['defer', 'editReply']);
  assert.match(String((log[1]!.payload as { content: string }).content), /опубликована/);
  assert.equal(getDraft(user.id), null, 'черновик удалён');

  assert.equal(posted.length, 1);
  assert.match(String(posted[0]!.content), /<@&R>/, 'пинг роли');
  const raid = getRaid(1)!;
  assert.equal(raid.title, 'Огненные Недра (героик)');
  assert.equal(raid.description, 'Сбор в 19:45 у входа');
  assert.equal(raid.size, 25);
  assert.equal(raid.leaderName, 'Офицер');
  assert.equal(raid.startsAt, kyiv(tomorrow(), '20:00'));
  assert.equal(getRaidImage(raid.id)?.name, 'raid-image.png', 'картинка сохранена для перерисовок');
});

test('кнопка из старого сообщения после публикации — ничего не ломает', async () => {
  const log = await press('rwiz:publish');
  assert.deepEqual(log.map((entry) => entry.kind), ['update', 'followUp']);
  assert.match(String((log[1]!.payload as { content: string }).content), /уже опубликована или отменена/);
  assert.equal(posted.length, 1);
});
