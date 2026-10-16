import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

process.env.BOT_DB_PATH = ':memory:';
const { roleButtonHandler } = await import('./roleButtons.ts');
const { expireTempRoles, roleExpiry } = await import('./tempRoles.ts');

const HOUR = 3_600_000;

// Подставной сервер: у участника набор ролей, роль «Событие» бот выдавать может.
const owned = new Set<string>();
const role = { id: 'E', guild: { id: 'g' }, managed: false, editable: true, permissions: { has: () => false }, toString: () => '<@&E>' };
const member = {
  id: 'u1',
  roles: {
    cache: { has: (id: string) => owned.has(id) },
    add: async (r: { id: string }) => void owned.add(r.id),
    remove: async (r: { id: string }) => void owned.delete(r.id),
  },
};
const guild = { id: 'g', roles: { cache: new Map([['E', role]]) }, members: { fetch: async () => member } };
const client = { guilds: { cache: new Map([['g', guild]]) } };
const replies: string[] = [];
const press = (args: string[]) =>
  roleButtonHandler.handle(
    { isButton: () => true, guild, member, reply: async (p: { content: string }) => void replies.push(p.content) } as never,
    args,
  );

test('роль на время: выдаётся со сроком, повторное нажатие снимает и забывает срок', async () => {
  mock.timers.enable({ apis: ['Date'], now: 1_000_000_000_000 });
  try {
    await press(['E', '24']);
    assert.ok(owned.has('E'));
    assert.equal(roleExpiry('g', 'u1', 'E'), 1_000_000_000_000 + 24 * HOUR);
    assert.match(replies.at(-1)!, /на время — снимется сама/);

    await press(['E', '24']);
    assert.equal(owned.has('E'), false);
    assert.equal(roleExpiry('g', 'u1', 'E'), null);
  } finally {
    mock.timers.reset();
  }
});

test('по истечении срока роль снимается — в том числе после перезапуска (срок берётся из базы)', async () => {
  mock.timers.enable({ apis: ['Date'], now: 1_000_000_000_000 });
  try {
    await press(['E', '2']);
    await expireTempRoles(client as never);
    assert.ok(owned.has('E'), 'срок ещё не вышел');

    // «Перезапуск»: ничего не держим в памяти — expireTempRoles читает только базу.
    mock.timers.tick(2 * HOUR);
    await expireTempRoles(client as never);
    assert.equal(owned.has('E'), false);
    assert.equal(roleExpiry('g', 'u1', 'E'), null);
  } finally {
    mock.timers.reset();
  }
});

test('обычная панель (без срока) работает как раньше', async () => {
  await press(['E']);
  assert.ok(owned.has('E'));
  assert.equal(roleExpiry('g', 'u1', 'E'), null);
  assert.match(replies.at(-1)!, /^➕ Роль <@&E> выдана\.$/);
});
