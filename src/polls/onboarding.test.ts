import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EmbedBuilder } from 'discord.js';

process.env.BOT_DB_PATH = ':memory:';
const { pollHandler } = await import('./handlers.ts');
const { parsePollFile } = await import('./format.ts');
const { createPoll } = await import('./store.ts');
const { getSettings, saveSettings } = await import('../botSettings.ts');

const parsed = parsePollFile('# Анкета новичка\n\n## О себе\n### Кем хочешь играть? *\n( ) Танк\n( ) Лекарь\n\n### Когда бываешь онлайн\nОтвет: короткий\n');
assert.ok(parsed.ok);
const [role, online] = parsed.poll.blocks[0]!.questions;

// Подставной сервер: роль «Рейдер» (бот может выдать), «Незнакомец» (у новичка), канал оповещений A.
const alerts: { embeds: EmbedBuilder[] }[] = [];
const roles = new Map([
  ['RAID', { id: 'RAID', name: 'Рейдер', editable: true }],
  ['NEW', { id: 'NEW', name: 'Незнакомец', editable: true }],
]);
const guild = {
  id: 'G',
  roles: { cache: roles },
  channels: { cache: new Map([['A', { isSendable: () => true, send: async (payload: { embeds: EmbedBuilder[] }) => void alerts.push(payload) }]]) },
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

/** Отправить форму единственного блока опроса от имени новичка. */
async function submit(pollId: number) {
  const interaction = {
    user: { id: '7' },
    member,
    guild,
    isModalSubmit: () => true,
    isButton: () => false,
    isFromMessage: () => true,
    update: async () => {},
    reply: async () => {},
    fields: {
      getRadioGroup: () => role!.options[0]!.value,
      getTextInputValue: () => 'по вечерам',
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
