import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PermissionFlagsBits } from 'discord.js';

process.env.BOT_DB_PATH = ':memory:';
const { group } = await import('./group.ts');
const { canManage, createProblem, parseLimit } = await import('../../raids/groups.ts');
const { getSettings, saveSettings } = await import('../../botSettings.ts');
const { getRaid, listRaids } = await import('../../raids/store.ts');

test('правила групп: кто открывает, кто управляет, лимит из команды', () => {
  const settings = { channelId: 'G', size: 5, limits: { tank: 1, healer: 1, dps: 3 }, creatorRoleIds: ['R'] };
  assert.match(createProblem({ ...settings, channelId: null }, 'Подземелье', new Set(['R']))!, /пока не настроены/);
  assert.match(createProblem(settings, 'Подземелье', new Set(['X']))!, /могут роли: <@&R>/);
  assert.equal(createProblem(settings, 'Подземелье', new Set(['R'])), null);
  assert.equal(createProblem({ ...settings, creatorRoleIds: [] }, 'Подземелье', new Set()), null, 'без ролей — любой участник');

  assert.equal(canManage({ player: true, createdBy: 'u1' }, 'u1', false), true);
  assert.equal(canManage({ player: true, createdBy: 'u1' }, 'u2', false), false);
  assert.equal(canManage({ player: false, createdBy: 'u1' }, 'u1', false), false, 'регу офицера игрок не меняет, даже если создавал её сам');
  assert.equal(canManage({ player: false, createdBy: 'o' }, 'u2', true), true, 'офицер — любую');

  assert.deepEqual(parseLimit(null, 'Танки'), { change: false });
  assert.deepEqual(parseLimit('2', 'Лекари'), { change: true, value: 2 });
  assert.deepEqual(parseLimit('нет', 'Лекари'), { change: true, value: null });
  assert.match((parseLimit('два', 'Лекари') as { error: string }).error, /число от 0 до 100 или «нет»/);
});

// Подставной сервер: канал групп G, участники с ролями; что бот ответил и что опубликовал.
const answers: string[] = [];
const posted: { content?: string }[] = [];
const edits: unknown[] = [];
const channel = {
  messages: { fetch: async () => ({ flags: { has: () => false }, edit: async (payload: unknown) => void edits.push(payload) }) },
  id: 'G',
  guild: { id: 'g', name: 'The Last Hope' },
  client: null as unknown,
  isTextBased: () => true,
  isDMBased: () => false,
  permissionsFor: () => ({ has: () => true }),
  send: async (payload: { content?: string }) => {
    posted.push(payload);
    return { id: `m${posted.length}` };
  },
  toString: () => '<#G>',
};
const client = { channels: { fetch: async (id: string) => (id === 'G' ? channel : null) }, guilds: { cache: new Map() } };
channel.client = client;

function run(sub: string, userId: string, options: Record<string, string | number>, { roles = ['R'], officer = false } = {}) {
  const answer = async (payload: string | { content?: string }) => void answers.push(typeof payload === 'string' ? payload : (payload.content ?? ''));
  const interaction = {
    options: {
      getSubcommand: () => sub,
      getString: (name: string) => (options[name] === undefined ? null : String(options[name])),
      getInteger: (name: string) => (options[name] === undefined ? null : Number(options[name])),
    },
    user: { id: userId },
    member: { displayName: `Игрок ${userId}`, roles: { cache: new Map(roles.map((r) => [r, {}])) } },
    memberPermissions: { has: (perm: bigint) => officer && perm === PermissionFlagsBits.ManageEvents },
    guild: { id: 'g', members: { me: {} } },
    client,
    reply: answer,
    deferReply: async () => {},
    editReply: answer,
  };
  return group.execute(interaction as never);
}

test('/group: игрок с ролью открывает подземелье, чужую группу не трогает, лимиты меняет свою', async () => {
  const s = structuredClone(getSettings());
  s.groups.dungeon = { channelId: 'G', size: 5, limits: { tank: 1, healer: 1, dps: 3 }, creatorRoleIds: ['R'] };
  saveSettings(s);
  const later = (h: number) => {
    const d = new Date(Date.now() + h * 3_600_000);
    return { date: `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`, time: '23:30' };
  };

  await run('create', 'p1', { kind: 'dungeon', title: 'Мёртвые копи', ...later(48) }, { roles: [] });
  assert.match(answers.at(-1)!, /Открывать группы «Подземелье» могут роли/);

  await run('create', 'p1', { kind: 'dungeon', title: 'Мёртвые копи', ...later(48), note: 'Ключ есть' });
  assert.match(answers.at(-1)!, /Группа открыта в <#G>/);
  const raid = listRaids('g', 'open')[0]!;
  assert.deepEqual([raid.title, raid.kind, raid.size, raid.player, raid.createdBy, raid.description], ['Мёртвые копи', 'dungeon', 5, true, 'p1', 'Ключ есть']);
  assert.deepEqual(raid.limits, { tank: 1, healer: 1, dps: 3 });
  assert.equal(posted.at(-1)?.content, undefined, 'группа игрока никого не упоминает');

  await run('cancel', 'p2', { group: String(raid.id) });
  assert.match(answers.at(-1)!, /Это не твоя группа/);
  assert.equal(getRaid(raid.id)!.status, 'open');

  await run('limits', 'p1', { group: String(raid.id), healers: '2', size: 6 });
  assert.match(answers.at(-1)!, /Подземелье · 6 мест · 1 танк, 2 лекаря, 3 бойца/);
  assert.deepEqual([getRaid(raid.id)!.size, getRaid(raid.id)!.limits.healer], [6, 2]);
  assert.ok(edits.length > 0, 'рега перерисована с новыми лимитами');

  await run('limits', 'p1', { group: String(raid.id), tanks: '9' });
  assert.match(answers.at(-1)!, /в сумме \(14\) больше мест в составе \(6\)/);

  await run('cancel', 'officer', { group: String(raid.id) }, { officer: true });
  assert.equal(getRaid(raid.id)!.status, 'cancelled', 'офицер может отменить любую');
});
