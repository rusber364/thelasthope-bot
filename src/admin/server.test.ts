import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CDN, ChannelType, Collection, type Client, type ImageURLOptions } from 'discord.js';
import { generateSignedCookie } from 'hono/cookie';

process.env.BOT_DB_PATH = ':memory:';
process.env.SESSION_SECRET = 'test-secret';
process.env.CLIENT_ID = '1';
process.env.DISCORD_CLIENT_SECRET = 'x';

const { createApp } = await import('./server.ts');
const { getSettings } = await import('../botSettings.ts');

// Подставной «Discord»: сервер с двумя текстовыми каналами, голосовым и ролями.
const channel = (id: string, name: string, type = ChannelType.GuildText) => ({ id, name, type, rawPosition: Number(id.slice(1)), parent: null, isSendable: () => false });
const role = (id: string, name: string, position: number, extra = {}) => ({ id, name, position, managed: false, editable: true, ...extra });
const ADMIN = '10';
const guild = {
  id: 'g1',
  name: 'Тест',
  memberCount: 5,
  channels: { cache: new Collection([channel('c1', 'приветствие'), channel('c2', 'лог-голос'), channel('c3', 'голос', ChannelType.GuildVoice)].map((c) => [c.id, c])) },
  roles: { cache: new Collection([role('g1', '@everyone', 0), role('r1', 'Гость', 1), role('r2', 'Офицер', 5, { editable: false })].map((r) => [r.id, r])) },
  members: {
    fetch: async (id: string) => ({ id, permissions: { has: () => id === ADMIN } }),
    // Для сверки голосовых ролей после сохранения: на подставном сервере никого нет.
    cache: { filter: () => ({ map: () => [] }), get: () => undefined },
  },
  voiceStates: { cache: new Map() },
};
// Подставной REST: запоминает, что бот отправлял в PATCH /users/@me.
const patches: Record<string, unknown>[] = [];
let failNextPatch = false;
const rest = {
  patch: async (_route: string, options: { body: Record<string, unknown> }) => {
    if (failNextPatch) {
      failNextPatch = false;
      throw new Error('You are changing your avatar too fast. Try again later.');
    }
    patches.push(options.body);
    return { id: 'bot', avatar: 'a1', banner: 'b1' };
  },
};
// Ссылки на картинки строит настоящий CDN discord.js: недопустимый размер падает так же, как у живого бота.
const cdn = new CDN();
const user = {
  tag: 'Bot#0001',
  id: 'bot',
  banner: null as string | null,
  fetch: async () => user,
  displayAvatarURL: (options?: ImageURLOptions) => cdn.avatar('bot', 'a1', options),
  bannerURL: (options?: ImageURLOptions) => (user.banner ? cdn.banner('bot', user.banner, options) : null),
};
const client = { user, rest, ws: { ping: 42 }, guilds: { cache: new Collection([['g1', guild]]) } } as unknown as Client<true>;
const app = createApp(client);

async function cookieFor(userId: string, csrf = 'token') {
  const session = JSON.stringify({ userId, name: 'Тестер', avatar: null, csrf, expires: Date.now() + 60_000 });
  return (await generateSignedCookie('tlh_session', session, 'test-secret')).split(';')[0]!;
}

const form = (fields: [string, string][]) => new URLSearchParams(fields);
const post = async (path: string, fields: [string, string][], userId = ADMIN) =>
  app.request(path, {
    method: 'POST',
    headers: { Cookie: await cookieFor(userId), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form(fields),
  });

test('без входа — страница входа, закрытые страницы ведут на неё', async () => {
  const home = await app.request('/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Войти через Discord/);

  const channels = await app.request('/channels');
  assert.equal(channels.status, 302);
  assert.equal(channels.headers.get('location'), '/');
});

test('не админ сервера получает «Нет доступа»', async () => {
  const res = await app.request('/channels', { headers: { Cookie: await cookieFor('99') } });
  assert.equal(res.status, 403);
  assert.match(await res.text(), /Нет доступа/);
});

test('админ видит текстовые каналы и роли, голосовые и @everyone — нет', async () => {
  const res = await app.request('/channels', { headers: { Cookie: await cookieFor(ADMIN) } });
  assert.equal(res.status, 200);
  const page = await res.text();
  assert.match(page, /#приветствие/);
  assert.doesNotMatch(page, />#голос</);
  assert.match(page, /Гость/);
  assert.doesNotMatch(page, /@everyone/);
});

test('форма без верного CSRF-токена отклоняется', async () => {
  const res = await post('/channels', [['_csrf', 'wrong'], ['welcome', 'c1']]);
  assert.equal(res.status, 403);
  assert.equal(getSettings().channels.welcome, null);
});

test('сохранение каналов и ролей', async () => {
  const res = await post('/channels', [['_csrf', 'token'], ['welcome', 'c1'], ['rules', ''], ['auth', ''], ['guest', 'r1'], ['autorole', '']]);
  assert.equal(res.status, 302);
  assert.equal(getSettings().channels.welcome, 'c1');
  assert.equal(getSettings().roles.guest, 'r1');
});

test('несуществующий или голосовой канал — ошибка, ничего не сохраняется', async () => {
  const res = await post('/channels', [['_csrf', 'token'], ['welcome', 'c3'], ['guest', 'r1']]);
  assert.equal(res.status, 400);
  assert.match(await res.text(), /такого текстового канала нет/);
  assert.equal(getSettings().channels.welcome, 'c1');
});

test('логи: канал и выключение галочкой', async () => {
  const res = await post('/logs', [['_csrf', 'token'], ['voice_channel', 'c2'], ['voice_enabled', 'on'], ['members_channel', 'c2']]);
  assert.equal(res.status, 302);
  const { logs } = getSettings();
  assert.deepEqual(logs.voice, { channelId: 'c2', enabled: true });
  assert.deepEqual(logs.members, { channelId: 'c2', enabled: false });
});

test('голосовые роли: связка сохраняется, пустая строка игнорируется, удаление галочкой', async () => {
  const page = await (await app.request('/channels', { headers: { Cookie: await cookieFor(ADMIN) } })).text();
  assert.match(page, /Голосовые роли/);
  const add = await post('/channels', [['_csrf', 'token'], ['welcome', 'c1'], ['guest', 'r1'], ['vrCount', '2'], ['vr0_channel', 'c3'], ['vr0_role', 'r1'], ['vr1_channel', ''], ['vr1_role', '']]);
  assert.equal(add.status, 302);
  assert.deepEqual(getSettings().voiceRoles, [{ channelId: 'c3', roleId: 'r1' }]);

  const textChannel = await post('/channels', [['_csrf', 'token'], ['welcome', 'c1'], ['vrCount', '1'], ['vr0_channel', 'c1'], ['vr0_role', 'r1']]);
  assert.equal(textChannel.status, 400);
  assert.match(await textChannel.text(), /Голосовая роль 1: такого голосового канала нет/);

  const removed = await post('/channels', [['_csrf', 'token'], ['welcome', 'c1'], ['guest', 'r1'], ['vrCount', '2'], ['vr0_channel', 'c3'], ['vr0_role', 'r1'], ['vr0_delete', 'on']]);
  assert.equal(removed.status, 302);
  assert.deepEqual(getSettings().voiceRoles, []);
});

test('липкие сообщения: сохраняются, пустой текст и два в одном канале — ошибки', async () => {
  const page = await (await app.request('/sticky', { headers: { Cookie: await cookieFor(ADMIN) } })).text();
  assert.match(page, /Липкие сообщения/);
  const ok = await post('/sticky', [['_csrf', 'token'], ['interval', '30'], ['count', '2'], ['st0_channel', 'c1'], ['st0_text', 'Правила'], ['st1_channel', ''], ['st1_text', '']]);
  assert.equal(ok.status, 302);
  assert.deepEqual(getSettings().sticky, { intervalSeconds: 30, items: [{ channelId: 'c1', text: 'Правила' }] });

  const bad = await post('/sticky', [['_csrf', 'token'], ['interval', '30'], ['count', '2'], ['st0_channel', 'c1'], ['st0_text', ' '], ['st1_channel', 'c1'], ['st1_text', 'Ещё']]);
  assert.equal(bad.status, 400);
  const errors = await bad.text();
  assert.match(errors, /текст не может быть пустым/);
  assert.match(errors, /в одном канале может быть только одно/);
});

test('прощание: канал и текст сохраняются, пустой текст — ошибка', async () => {
  const page = await (await app.request('/welcome', { headers: { Cookie: await cookieFor(ADMIN) } })).text();
  assert.match(page, /Прощание/);
  const ok = await post('/farewell', [['_csrf', 'token'], ['farewellChannel', 'c2'], ['farewellText', '{name} уходит']]);
  assert.equal(ok.status, 302);
  assert.deepEqual(getSettings().farewell, { channelId: 'c2', text: '{name} уходит' });
  const empty = await post('/farewell', [['_csrf', 'token'], ['farewellChannel', 'c2'], ['farewellText', '  ']]);
  assert.equal(empty.status, 400);
  assert.match(await empty.text(), /Текст прощания: не может быть пустым/);
});

test('лог-рейдов настраивается на странице логов', async () => {
  const page = await (await app.request('/logs', { headers: { Cookie: await cookieFor(ADMIN) } })).text();
  assert.match(page, /лог-рейдов/);
  const res = await post('/logs', [['_csrf', 'token'], ['raids_channel', 'c2'], ['raids_enabled', 'on']]);
  assert.equal(res.status, 302);
  assert.deepEqual(getSettings().logs.raids, { channelId: 'c2', enabled: true });
});

test('оповещения: канал, роль офицеров, пороги, голосовой канал', async () => {
  const ok = await post('/alerts', [
    ['_csrf', 'token'], ['alertsChannel', 'c2'], ['alertsRole', 'r2'], ['lateCancelHours', '2'],
    ['gatherMinutes', '10'], ['attendanceMinutes', '20'], ['attendanceVoice', 'c3'],
  ]);
  assert.equal(ok.status, 302);
  const s = getSettings();
  assert.deepEqual(s.alerts, { channelId: 'c2', roleId: 'r2', lateCancelHours: 2 });
  assert.equal(s.raids.gatherMinutes, 10);
  assert.equal(s.raids.attendanceVoiceChannelId, 'c3');

  // Текстовый канал вместо голосового и отрицательные минуты — ошибки.
  const bad = await post('/alerts', [['_csrf', 'token'], ['attendanceVoice', 'c1'], ['gatherMinutes', '-5'], ['lateCancelHours', '2'], ['attendanceMinutes', '20']]);
  assert.equal(bad.status, 400);
  const page = await bad.text();
  assert.match(page, /такого голосового канала нет/);
  assert.match(page, /Сбор перед рейдом/);
});

test('оформление: главная показывает аватар, кнопки отправляют логотип в Discord', async () => {
  const home = await app.request('/', { headers: { Cookie: await cookieFor(ADMIN) } });
  const page = await home.text();
  assert.match(page, /Оформление бота/);
  assert.match(page, /avatars\/bot\/a1\./);
  assert.match(page, /Баннер не задан/);

  user.banner = 'b1';
  const withBanner = await app.request('/', { headers: { Cookie: await cookieFor(ADMIN) } });
  assert.equal(withBanner.status, 200);
  assert.match(await withBanner.text(), /banners\/bot\/b1\./);

  const avatar = await post('/branding/avatar', [['_csrf', 'token']]);
  assert.equal(avatar.status, 302);
  assert.match(decodeURIComponent(avatar.headers.get('location') ?? ''), /Аватар бота обновлён/);
  assert.match(String(patches.at(-1)?.avatar), /^data:image\/jpeg;base64,/);

  const banner = await post('/branding/banner', [['_csrf', 'token']]);
  assert.equal(banner.status, 302);
  assert.ok(patches.at(-1)?.banner, 'баннер отправлен');

  failNextPatch = true;
  const tooFast = await post('/branding/avatar', [['_csrf', 'token']]);
  assert.match(decodeURIComponent(tooFast.headers.get('location') ?? ''), /не разрешает менять аватар или баннер так часто/);

  const unknown = await post('/branding/name', [['_csrf', 'token']]);
  assert.equal(unknown.status, 404);
});

test('расписание: несколько дней, удаление и проверка времени', async () => {
  const [first, second] = getSettings().raids.schedules;
  const base: [string, string][] = [
    ['_csrf', 'token'], ['defaultSize', '25'], ['defaultTime', '19:30'], ['tempRole', 'r1'], ['tempRoleHours', '4'], ['archiveMode', 'move'], ['archiveChannel', 'c2'], ['archiveHours', '6'], ['count', '2'],
    ['s0_id', first!.id], ['s0_title', 'Огненные Недра'], ['s0_channel', 'c1'], ['s0_ping', 'r1'], ['s0_days', '1'], ['s0_days', '4'], ['s0_days', '5'],
    ['s0_openAt', '00:00'], ['s0_raidTime', '20:00'], ['s0_offset', '0'],
    ['s1_id', second!.id], ['s1_title', 'Удалить'], ['s1_channel', ''], ['s1_days', '2'], ['s1_openAt', '00:00'], ['s1_raidTime', '20:00'], ['s1_offset', '0'], ['s1_delete', 'on'],
  ];
  const ok = await post('/raids', base);
  assert.equal(ok.status, 302);
  const { raids } = getSettings();
  assert.equal(raids.defaultSize, 25);
  assert.equal(raids.schedules.length, 1);
  assert.deepEqual(raids.schedules[0]!.days, [1, 4, 5]);
  assert.equal(raids.schedules[0]!.channelId, 'c1');
  assert.equal(raids.schedules[0]!.pingRoleId, 'r1');
  assert.equal(raids.tempRoleId, 'r1');
  assert.equal(raids.tempRoleHours, 4);
  assert.deepEqual(raids.archive, { mode: 'move', channelId: 'c2', hours: 6 });

  const noArchiveChannel = await post('/raids', base.map(([k, v]) => [k, k === 'archiveChannel' ? '' : v]));
  assert.equal(noArchiveChannel.status, 400);
  assert.match(await noArchiveChannel.text(), /для переноса выбери канал-архив/);

  const bad = await post('/raids', base.map(([k, v]) => [k, k === 's0_raidTime' ? '25:99' : v]));
  assert.equal(bad.status, 400);
  assert.match(await bad.text(), /время рейда/);
});
