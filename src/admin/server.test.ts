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
const { createPoll, getPoll, saveResponse } = await import('../polls/store.ts');
const { listRaids } = await import('../raids/store.ts');

// Подставной «Discord»: сервер с двумя текстовыми каналами, голосовым и ролями.
const channel = (id: string, name: string, type = ChannelType.GuildText) => ({ id, name, type, rawPosition: Number(id.slice(1)), parent: null, isSendable: () => false });
const role = (id: string, name: string, position: number, extra = {}) => ({ id, name, position, managed: false, editable: true, ...extra });
const ADMIN = '10';
const dms: { content?: string }[] = [];
// Канал для опросов: туда бот может писать, а сообщение опроса — найти и перерисовать.
const pollPosts: { files?: unknown[]; components?: unknown[] }[] = [];
const pollEdits: unknown[] = [];
const pollChannel = {
  ...channel('c4', 'опросы'),
  guildId: 'g1',
  guild: { id: 'g1' }, // для публикации реги из шаблона
  get client() {
    return client;
  },
  isSendable: () => true,
  isTextBased: () => true,
  isDMBased: () => false,
  send: async (payload: { files?: unknown[] }) => {
    pollPosts.push(payload);
    return { id: `m${pollPosts.length}`, url: `https://discord.com/channels/g1/c4/m${pollPosts.length}` };
  },
  messages: { fetch: async () => ({ attachments: new Map(), edit: async (payload: unknown) => void pollEdits.push(payload) }) },
};
const member = (id: string) => ({
  id,
  displayName: 'Тестер',
  user: { username: 'tester' },
  guild,
  permissions: { has: () => id === ADMIN },
  send: async (payload: { content?: string }) => void dms.push(payload),
});
const guild = {
  id: 'g1',
  name: 'Тест',
  memberCount: 5,
  channels: { cache: new Collection([channel('c1', 'приветствие'), channel('c2', 'лог-голос'), channel('c3', 'голос', ChannelType.GuildVoice), pollChannel].map((c) => [c.id, c])) },
  roles: { cache: new Collection([role('g1', '@everyone', 0), role('r1', 'Гость', 1), role('r2', 'Офицер', 5, { editable: false })].map((r) => [r.id, r])) },
  members: {
    // Один участник по id или несколько ({ user: [...] }) — для имён в итогах опросов.
    fetch: async (arg: string | { user: string[] }) =>
      typeof arg === 'string' ? member(arg) : new Collection(arg.user.map((id) => [id, member(id)])),
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

test('приветствие в личку: галочка, текст и пробная отправка', async () => {
  const page = await (await app.request('/welcome', { headers: { Cookie: await cookieFor(ADMIN) } })).text();
  assert.match(page, /Приветствие в личку/);
  assert.equal(getSettings().welcomeDm.enabled, false, 'по умолчанию выключено');

  const on = await post('/welcome/dm', [['_csrf', 'token'], ['dmEnabled', 'on'], ['dmText', 'Привет, {name}! Это {server}.']]);
  assert.equal(on.status, 302);
  assert.deepEqual(getSettings().welcomeDm, { enabled: true, text: 'Привет, {name}! Это {server}.' });

  const off = await post('/welcome/dm', [['_csrf', 'token'], ['dmText', 'Привет, {name}! Это {server}.']]);
  assert.equal(off.status, 302);
  assert.equal(getSettings().welcomeDm.enabled, false, 'снятая галочка выключает');

  const empty = await post('/welcome/dm', [['_csrf', 'token'], ['dmEnabled', 'on'], ['dmText', ' ']]);
  assert.equal(empty.status, 400);
  assert.match(await empty.text(), /Приветствие в личку: не может быть пустым/);

  const trial = await post('/welcome/dm/test', [['_csrf', 'token']]);
  assert.match(decodeURIComponent(trial.headers.get('location') ?? ''), /отправлено тебе в личку/);
  assert.equal(dms.at(-1)?.content, 'Привет, Тестер! Это Тест.');
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
    ['gatherMinutes', '10'], ['attendanceMinutes', '20'], ['attendanceVoice', 'c3'], ['incidentChannel', 'c1'],
  ]);
  assert.equal(ok.status, 302);
  const s = getSettings();
  assert.deepEqual(s.alerts, { channelId: 'c2', roleId: 'r2', lateCancelHours: 2, incidentChannelId: 'c1' });
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

test('опросы: шаблон, ошибки по строкам, предпросмотр, публикация, итоги, таблица, копия, закрытие', async () => {
  const cookie = { Cookie: await cookieFor(ADMIN) };
  const get = async (path: string) => app.request(path, { headers: cookie });
  const postForm = async (fields: [string, string | Blob][]) => {
    const body = new FormData();
    for (const [key, value] of fields) body.append(key, value);
    return app.request('/polls/new', { method: 'POST', headers: cookie, body });
  };

  assert.match(await (await get('/polls')).text(), /Опросов пока нет/);
  const editor = await (await get('/polls/new')).text();
  assert.match(editor, /Warcraft Forever — формат гильдии/, 'открывается шаблон');
  assert.match(editor, /data-draft="restore"/);

  const broken = await postForm([['_csrf', 'token'], ['action', 'check'], ['source', '# Опрос\n\n### Вопрос без страницы']]);
  assert.equal(broken.status, 400);
  assert.match(await broken.text(), /data-line="3">Строка 3: вопрос должен быть внутри блока/);

  const source = '# Рейды осенью\n\n## Дни\n\n### Какие дни удобны? *\n[ ] Четверг\n[ ] Пятница\n\n### Пожелания\nОтвет: длинный\n\n## Про четверг\nЕсли: Какие дни удобны? != Четверг\n\n### Почему не четверг?\nОтвет: короткий\n';
  const preview = await postForm([['_csrf', 'token'], ['action', 'check'], ['source', source]]);
  assert.equal(preview.status, 200);
  const previewPage = await preview.text();
  assert.match(previewPage, /Предпросмотр/);
  assert.match(previewPage, /Показывается, только если «Какие дни удобны\?» ≠ «Четверг»/);

  const noChannel = await postForm([['_csrf', 'token'], ['action', 'publish'], ['source', source]]);
  assert.equal(noChannel.status, 400);
  assert.match(await noChannel.text(), /Выбери канал/);
  assert.equal(pollPosts.length, 0);

  const image = new File([new Uint8Array([137, 80, 78, 71])], 'осень.png', { type: 'image/png' });
  const published = await postForm([['_csrf', 'token'], ['action', 'publish'], ['source', source], ['channel', 'c4'], ['role', 'r1'], ['image', image]]);
  assert.equal(published.status, 302);
  const location = published.headers.get('location') ?? '';
  const id = Number(/\/polls\/(\d+)\?published=1/.exec(location)?.[1]);
  assert.ok(id, location);
  assert.equal(pollPosts.length, 1);
  assert.equal(pollPosts[0]!.files?.length, 1, 'картинка ушла вложением');
  const stored = getPoll(id)!;
  assert.equal(stored.source, source);
  assert.equal(stored.messageId, 'm1');
  assert.equal(stored.definition.mentionRoleId, 'r1');

  saveResponse(id, '20', { answers: { q1: ['o1', 'o2'], q2: ['Пораньше бы'] }, done: [0] }, true);
  saveResponse(id, '21', { answers: { q1: ['o2'] }, done: [0] }, false);
  const results = await (await get(location)).text();
  assert.match(results, /Опрос опубликован/);
  assert.match(results, /<b>1<\/b>завершили/);
  assert.match(results, /50% · 1/);
  assert.match(results, /100% · 2/);
  assert.match(results, /Тестер \(@tester\):<\/b> Пораньше бы/);
  assert.match(results, /localStorage\.removeItem/, 'после публикации черновик забывается');

  const byUser = await (await get(`/polls/${id}?view=users`)).text();
  assert.match(byUser, /По участникам \(2\)/);
  assert.match(byUser, /Тестер \(@tester\) <span class="hint">— опрос пройден/);
  assert.match(byUser, /<dt>Какие дни удобны\?<\/dt><dd>Четверг; Пятница<\/dd>/);
  assert.match(byUser, /опрос не закончен/);

  const list = await (await get('/polls')).text();
  assert.match(list, /Рейды осенью/);
  assert.match(list, /\+1 не закончили/);

  const csv = await get(`/polls/${id}/csv`);
  assert.match(csv.headers.get('content-type') ?? '', /text\/csv/);
  const bytes = Buffer.from(await csv.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM для Excel');
  const table = bytes.toString('utf8');
  assert.match(table, /Какие дни удобны\?/);
  assert.match(table, /Тестер \(@tester\)/);

  const copy = await (await get(`/polls/new?from=${id}`)).text();
  assert.match(copy, /data-draft="keep"/);
  assert.match(copy, /Почему не четверг\?/);

  const closed = await post(`/polls/${id}/close`, [['_csrf', 'token']]);
  assert.equal(closed.status, 302);
  assert.equal(getPoll(id)!.closed, true);
  assert.equal(pollEdits.length, 1, 'сообщение опроса перерисовано');
  assert.doesNotMatch(await (await get(`/polls/${id}`)).text(), /Закрыть опрос<\/button>/);

  const anonymous = createPoll('g1', 'c4', { ...stored.definition, anonymous: true }, 'u');
  saveResponse(anonymous.id, '20', { answers: { q1: ['o1'] }, done: [0] }, true);
  const hidden = await (await get(`/polls/${anonymous.id}?view=users`)).text();
  assert.match(hidden, /Опрос анонимный — ответы по участникам не показываются/);
  assert.doesNotMatch(hidden, /details class="person"/, 'карточек людей нет');

  const foreign = createPoll('другой-сервер', 'x', stored.definition, 'u');
  assert.equal((await get(`/polls/${foreign.id}`)).status, 404);
  assert.equal((await get('/polls/999')).status, 404);
});

test('шаблоны рег: сохранить, создать регу на дату, изменить и удалить', async () => {
  const cookie = { Cookie: await cookieFor(ADMIN) };
  assert.match(await (await app.request('/templates', { headers: cookie })).text(), /Шаблонов пока нет/);

  const noChannel = await post('/templates', [['_csrf', 'token'], ['count', '1'], ['t0_id', ''], ['t0_title', 'Огненные Недра'], ['t0_size', '40'], ['t0_time', '20:00'], ['t0_channel', '']]);
  assert.equal(noChannel.status, 400);
  assert.match(await noChannel.text(), /Шаблон 1: выбери канал/);

  const saved = await post('/templates', [
    ['_csrf', 'token'], ['count', '1'], ['t0_id', ''], ['t0_title', 'Огненные Недра'], ['t0_description', 'Сбор в 19:45'],
    ['t0_size', '40'], ['t0_time', '20:00'], ['t0_channel', 'c4'], ['t0_ping', 'r1'],
  ]);
  assert.equal(saved.status, 302);
  const template = getSettings().raidTemplates[0]!;
  assert.ok(template.id);
  assert.deepEqual({ ...template, id: '' }, { id: '', title: 'Огненные Недра', description: 'Сбор в 19:45', size: 40, time: '20:00', channelId: 'c4', pingRoleId: 'r1' });
  assert.match(await (await app.request('/templates', { headers: cookie })).text(), /Создать регу/);

  const tomorrow = Temporal.Now.plainDateISO('Europe/Kyiv').add({ days: 1 }).toString();
  const before = pollPosts.length;
  const created = await post(`/templates/${template.id}/create`, [['_csrf', 'token'], ['date', tomorrow], ['time', '21:00']]);
  assert.equal(created.status, 302);
  assert.match(decodeURIComponent(created.headers.get('location') ?? ''), /Рега #\d+ «Огненные Недра» создана в #опросы/);
  assert.equal(pollPosts.length, before + 1);
  assert.match(String((pollPosts.at(-1) as { content?: string }).content), /<@&r1>/, 'пинг роли из шаблона');
  const raid = listRaids('g1', 'open')[0]!;
  assert.equal(raid.startsAt, Temporal.PlainDate.from(tomorrow).toZonedDateTime({ timeZone: 'Europe/Kyiv', plainTime: Temporal.PlainTime.from('21:00') }).epochMilliseconds);
  assert.equal(raid.description, 'Сбор в 19:45');
  assert.equal(raid.leaderName, 'Тестер');

  const past = await post(`/templates/${template.id}/create`, [['_csrf', 'token'], ['date', '2020-01-01'], ['time', '20:00']]);
  assert.equal(past.status, 400);
  assert.match(await past.text(), /уже прошло/);

  const edited = await post('/templates', [
    ['_csrf', 'token'], ['count', '2'], ['t0_id', template.id], ['t0_title', 'Огненные Недра'], ['t0_description', ''],
    ['t0_size', '20'], ['t0_time', '19:30'], ['t0_channel', 'c4'], ['t0_ping', ''], ['t1_id', ''], ['t1_title', ''],
  ]);
  assert.equal(edited.status, 302);
  assert.deepEqual(getSettings().raidTemplates.map((t) => [t.id, t.size, t.time, t.pingRoleId]), [[template.id, 20, '19:30', null]]);

  const removed = await post('/templates', [
    ['_csrf', 'token'], ['count', '1'], ['t0_id', template.id], ['t0_title', 'Огненные Недра'], ['t0_size', '20'], ['t0_time', '19:30'], ['t0_channel', 'c4'], ['t0_delete', 'on'],
  ]);
  assert.equal(removed.status, 302);
  assert.deepEqual(getSettings().raidTemplates, []);
  assert.equal((await post(`/templates/${template.id}/create`, [['_csrf', 'token'], ['date', tomorrow]])).status, 404);
});

test('автоочистка: правило сохраняется, неверный срок — ошибка, правило убирается галочкой', async () => {
  const page = await (await app.request('/autoclean', { headers: { Cookie: await cookieFor(ADMIN) } })).text();
  assert.match(page, /Автоочистка каналов/);

  const bad = await post('/autoclean', [['_csrf', 'token'], ['count', '1'], ['ac0_channel', 'c2'], ['ac0_hours', '0'], ['ac0_keepBot', 'on']]);
  assert.equal(bad.status, 400);
  assert.match(await bad.text(), /срок — целое число часов от 1 до 720/);

  const ok = await post('/autoclean', [['_csrf', 'token'], ['count', '2'], ['ac0_channel', 'c2'], ['ac0_hours', '48'], ['ac1_channel', ''], ['ac1_hours', '24'], ['ac1_keepBot', 'on']]);
  assert.equal(ok.status, 302);
  assert.deepEqual(getSettings().autoClean, [{ channelId: 'c2', hours: 48, keepBot: false }]);

  const removed = await post('/autoclean', [['_csrf', 'token'], ['count', '1'], ['ac0_channel', 'c2'], ['ac0_hours', '48'], ['ac0_delete', 'on']]);
  assert.equal(removed.status, 302);
  assert.deepEqual(getSettings().autoClean, []);
});
