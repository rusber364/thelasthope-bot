import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EmbedBuilder } from 'discord.js';

process.env.BOT_DB_PATH = ':memory:';
const { pollHandler } = await import('./handlers.ts');
const { parsePollFile } = await import('./format.ts');
const { createPoll, getPollFile, getResponse } = await import('./store.ts');
const { getSettings, saveSettings } = await import('../botSettings.ts');

const parsed = parsePollFile('# Анкета новичка\n\n## О себе\n### Кем хочешь играть? *\n( ) Танк\n( ) Лекарь\n\n### Когда бываешь онлайн\nОтвет: короткий\n');
assert.ok(parsed.ok);
const [role, online] = parsed.poll.blocks[0]!.questions;

// Подставной сервер: роль «Рейдер» (бот может выдать), «Незнакомец» (у новичка), канал оповещений A.
const alerts: { embeds: EmbedBuilder[]; files?: { name: string | null }[] }[] = [];
const roles = new Map([
  ['RAID', { id: 'RAID', name: 'Рейдер', editable: true }],
  ['NEW', { id: 'NEW', name: 'Незнакомец', editable: true }],
]);
const guild = {
  id: 'G',
  roles: { cache: roles },
  channels: { cache: new Map([['A', { isSendable: () => true, send: async (payload: (typeof alerts)[number]) => void alerts.push(payload) }]]) },
  members: { fetch: async (id: string) => (id === '7' ? member : Promise.reject(new Error('Unknown Member'))) },
};
const memberRoles = new Set(['NEW']);
const member = {
  id: '7',
  displayName: 'Морозко',
  guild,
  toString: () => '<@7>',
  roles: {
    cache: { has: (id: string) => memberRoles.has(id) },
    add: async (r: { id: string }) => void memberRoles.add(r.id),
    remove: async (r: { id: string }) => void memberRoles.delete(r.id),
  },
};

/** Что бот ответил игроку. */
const replies: string[] = [];

/** Отправить форму единственного блока опроса от имени новичка. dm — из лички (не на сервере). */
async function submit(pollId: number, { dm = false, userId = '7', fields = {} as Record<string, unknown> } = {}) {
  const interaction = {
    user: { id: userId },
    ...(dm ? {} : { member, guild }),
    client: { guilds: { cache: new Map([['G', guild]]) } },
    inGuild: () => !dm,
    inCachedGuild: () => !dm,
    isModalSubmit: () => true,
    isButton: () => false,
    isFromMessage: () => true,
    update: async () => void replies.push('карточка'),
    reply: async (payload: { content?: string }) => void replies.push(payload.content ?? 'карточка'),
    fields: {
      getRadioGroup: () => role!.options[0]!.value,
      getTextInputValue: () => 'по вечерам',
      ...fields,
    },
  };
  await pollHandler.handle(interaction as never, ['submit', String(pollId), '0']);
  // Роль и карточка — уже после ответа игроку, в фоне.
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
}

const configure = (pollId: number, notify = true) => {
  const s = structuredClone(getSettings());
  s.alerts.channelId = 'A';
  s.onboarding = { ...s.onboarding, pollId, roleId: 'RAID', removeRoleId: 'NEW', notify };
  saveSettings(s);
};

test('анкету заполнили — «Рейдер» выдан, «Незнакомец» снят, офицерам карточка с ответами; повторная отправка — без дубля', async () => {
  const survey = createPoll('G', 'W', parsed.poll, 'officer');
  configure(survey.id);
  await submit(survey.id);

  assert.deepEqual([...memberRoles], ['RAID']);
  assert.equal(alerts.length, 1);
  const card = alerts[0]!.embeds[0]!.toJSON();
  assert.equal(card.title, '📝 Анкета заполнена');
  assert.match(card.description!, /<@7> \(Морозко\)/);
  assert.deepEqual(
    card.fields?.map((f) => `${f.name}: ${f.value}`),
    [`${role!.title}: Танк`, `${online!.title}: по вечерам`],
  );

  await submit(survey.id);
  assert.equal(alerts.length, 1, 'анкета уже была заполнена — второй карточки нет');
});

test('анонимная анкета — карточка без ответов; карточка выключена — только роли; обычный опрос — ничего', async () => {
  alerts.length = 0;
  const anonymous = createPoll('G', 'W', { ...parsed.poll, anonymous: true }, 'officer');
  configure(anonymous.id);
  await submit(anonymous.id);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]!.embeds[0]!.toJSON().fields, undefined);

  memberRoles.clear();
  memberRoles.add('NEW');
  const quiet = createPoll('G', 'W', parsed.poll, 'officer');
  configure(quiet.id, false);
  await submit(quiet.id);
  assert.equal(alerts.length, 1, 'карточка выключена');
  assert.deepEqual([...memberRoles], ['RAID'], 'роли — всё равно');

  memberRoles.clear();
  const regular = createPoll('G', 'W', parsed.poll, 'officer');
  await submit(regular.id);
  assert.equal(alerts.length, 1);
  assert.deepEqual([...memberRoles], [], 'обычный опрос ролей не трогает');
});

test('анкету проходят из лички: участника бот находит на сервере опроса, роль и карточка — как обычно', async () => {
  alerts.length = 0;
  memberRoles.clear();
  memberRoles.add('NEW');
  const survey = createPoll('G', 'W', parsed.poll, 'officer');
  configure(survey.id);
  await submit(survey.id, { dm: true });
  assert.ok(getResponse(survey.id, '7')?.completedAt, 'ответ сохранён');
  assert.deepEqual([...memberRoles], ['RAID']);
  assert.equal(alerts.length, 1);

  // Кто ушёл с сервера, из лички ответить не может.
  await submit(survey.id, { dm: true, userId: '8' });
  assert.match(replies.at(-1) ?? '', /для участников сервера/);
  assert.equal(getResponse(survey.id, '8'), null);
});

const withImage = parsePollFile('# Анкета\n\n## Персонаж\n### Ник *\nОтвет: короткий\n\n### Скриншот персонажа *\nОтвет: картинка\n');
assert.ok(withImage.ok);
const [, shot] = withImage.poll.blocks[0]!.questions;
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

/** Форма с картинкой: Discord отдаёт вложение, бот его скачивает (fetch подменён). */
async function submitImage(pollId: number, attachment: { contentType: string | null; size: number }) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(PNG)) as typeof fetch;
  const calls: string[] = [];
  const interaction = {
    user: { id: '7' },
    member,
    guild,
    deferred: false,
    inGuild: () => true,
    inCachedGuild: () => true,
    isModalSubmit: () => true,
    isButton: () => false,
    isFromMessage: () => true,
    async deferUpdate() {
      calls.push('defer');
      this.deferred = true;
    },
    editReply: async () => void calls.push('card'),
    update: async () => void calls.push('update'),
    followUp: async (payload: { content: string }) => void calls.push(payload.content),
    fields: {
      getTextInputValue: () => 'Морозко',
      getUploadedFiles: () => ({ first: () => ({ name: 'me.png', url: 'https://cdn.discordapp.com/x/me.png', ...attachment }) }),
    },
  };
  try {
    await pollHandler.handle(interaction as never, ['submit', String(pollId), '0']);
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
  } finally {
    globalThis.fetch = realFetch;
  }
  return calls;
}

test('ответ-картинка: бот сначала «думает», скачивает и хранит картинку, офицерам она приходит в карточке', async () => {
  alerts.length = 0;
  const survey = createPoll('G', 'W', withImage.poll, 'officer');
  configure(survey.id);
  const calls = await submitImage(survey.id, { contentType: 'image/png', size: PNG.length });
  assert.deepEqual(calls, ['defer', 'card'], 'на 3 секунды — «бот думает», потом карточка');

  const answer = getResponse(survey.id, '7')!.state.answers[shot!.id]!;
  const file = getPollFile(Number(answer[0]));
  assert.equal(file?.contentType, 'image/png');
  assert.deepEqual([...file!.data], [...PNG]);

  const card = alerts[0]!.embeds[0]!.toJSON();
  assert.equal(card.image?.url, `attachment://answer-${shot!.id}.png`);
  assert.ok(card.fields?.some((f) => f.name === 'Скриншот персонажа' && /картинка/.test(f.value)));
  assert.deepEqual(alerts[0]!.files?.map((f) => f.name), [`answer-${shot!.id}.png`]);

  // Пройти заново — картинка удаляется вместе с ответами.
  const { resetResponse } = await import('./store.ts');
  resetResponse(survey.id, '7');
  assert.equal(getPollFile(Number(answer[0])), null);
});

test('не картинка или слишком большая — страница не засчитана, игрок видит, что не так', async () => {
  const survey = createPoll('G', 'W', withImage.poll, 'officer');
  const svg = await submitImage(survey.id, { contentType: 'image/svg+xml', size: 100 });
  assert.match(svg.at(-1)!, /PNG, JPG, GIF или WEBP/);
  assert.equal(getResponse(survey.id, '7'), null);

  const big = await submitImage(survey.id, { contentType: 'image/jpeg', size: 9 * 1024 * 1024 });
  assert.match(big.at(-1)!, /больше 8 МБ/);
  assert.equal(getResponse(survey.id, '7'), null);
});
