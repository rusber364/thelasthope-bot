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
const { createRaid, listRaids, markAttendanceDone, saveAttendance, upsertSignup } = await import('../raids/store.ts');

// Подставной «Discord»: два текстовых канала, голосовой, канал для опросов и рег, роли.
const channel = (id: string, name: string, type = ChannelType.GuildText) => ({ id, name, type, rawPosition: Number(id.slice(1)), parent: null, isSendable: () => false, isTextBased: () => false });
const role = (id: string, name: string, position: number, extra = {}) => ({ id, name, position, managed: false, editable: true, ...extra });
const ADMIN = '10';
const dms: { content?: string }[] = [];
const posts: { files?: unknown[]; content?: string }[] = [];
const edits: unknown[] = [];
const postChannel = {
  ...channel('c4', 'опросы'),
  guildId: 'g1',
  guild: { id: 'g1' },
  get client() {
    return client;
  },
  isSendable: () => true,
  isTextBased: () => true,
  isDMBased: () => false,
  send: async (payload: { files?: unknown[] }) => {
    posts.push(payload);
    return { id: `m${posts.length}`, url: `https://discord.com/channels/g1/c4/m${posts.length}` };
  },
  messages: { fetch: async () => ({ attachments: new Map(), edit: async (payload: unknown) => void edits.push(payload) }) },
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
  iconURL: () => null,
  channels: { cache: new Collection([channel('c1', 'приветствие'), channel('c2', 'лог-голос'), channel('c3', 'голос', ChannelType.GuildVoice), postChannel].map((c) => [c.id, c])) },
  roles: { cache: new Collection([role('g1', '@everyone', 0), role('r1', 'Гость', 1), role('r2', 'Офицер', 5, { editable: false })].map((r) => [r.id, r])) },
  members: {
    fetch: async (arg: string | { user: string[] }) => (typeof arg === 'string' ? member(arg) : new Collection(arg.user.map((id) => [id, member(id)]))),
    cache: { filter: () => ({ map: () => [] }), get: () => undefined },
  },
  voiceStates: { cache: new Map() },
};
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
const cdn = new CDN();
const user = {
  tag: 'Bot#0001',
  id: 'bot',
  banner: 'b1' as string | null,
  fetch: async () => user,
  displayAvatarURL: (options?: ImageURLOptions) => cdn.avatar('bot', 'a1', options),
  bannerURL: (options?: ImageURLOptions) => (user.banner ? cdn.banner('bot', user.banner, options) : null),
};
const client = { user, rest, ws: { ping: 42 }, guilds: { cache: new Collection([['g1', guild]]) }, channels: guild.channels } as unknown as Client<true>;
const app = createApp(client);

async function cookieFor(userId: string) {
  const session = JSON.stringify({ userId, name: 'Тестер', avatar: null, csrf: 'token', expires: Date.now() + 60_000 });
  return (await generateSignedCookie('tlh_session', session, 'test-secret')).split(';')[0]!;
}
/** Запрос к API от админа (или другого участника) с CSRF-заголовком. */
async function call(method: string, path: string, body?: unknown, { userId = ADMIN, csrf = 'token' as string | null } = {}) {
  const headers: Record<string, string> = { Cookie: await cookieFor(userId) };
  if (csrf) headers['X-CSRF-Token'] = csrf;
  let payload: FormData | string | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await app.request(`/api${path}`, { method, headers, ...(payload ? { body: payload } : {}) });
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, json: type.includes('json') ? ((await res.json()) as Record<string, any>) : null, res };
}
const put = (section: string, body: unknown) => call('PUT', `/settings/${section}`, body);

test('вход, права и CSRF', async () => {
  assert.equal((await app.request('/api/me')).status, 401);
  assert.equal((await call('GET', '/me', undefined, { userId: '99' })).status, 403);
  const noCsrf = await call('PUT', '/settings/welcome', { welcome: {} }, { csrf: null });
  assert.equal(noCsrf.status, 403);
  assert.match(noCsrf.json!.errors[0], /обнови/);

  const me = await call('GET', '/me');
  assert.equal(me.status, 200);
  assert.deepEqual(me.json, { user: { id: ADMIN, name: 'Тестер', avatar: null }, guild: { id: 'g1', name: 'Тест', iconUrl: null }, csrf: 'token' });
});

test('главная, варианты для списков и оформление бота', async () => {
  const overview = (await call('GET', '/overview')).json!;
  assert.equal(overview.bot, 'Bot#0001');
  assert.match(overview.avatarUrl, /avatars\/bot\/a1\..*size=128/);
  assert.match(overview.bannerUrl, /banners\/bot\/b1\..*size=512/);

  const options = (await call('GET', '/options')).json!;
  assert.deepEqual(options.textChannels.map((o: { id: string }) => o.id), ['c1', 'c2', 'c4']);
  assert.deepEqual(options.voiceChannels.map((o: { id: string }) => o.id), ['c3']);
  assert.ok(options.roles.find((o: { id: string; warning?: string }) => o.id === 'r2').warning, 'роль выше роли бота — с предупреждением');
  assert.ok(!options.roles.some((o: { id: string }) => o.id === 'g1'), '@everyone не предлагаем');

  const avatar = await call('POST', '/branding/avatar');
  assert.match(avatar.json!.message, /Аватар бота обновлён/);
  assert.match(String(patches.at(-1)?.avatar), /^data:image\/jpeg;base64,/);
  failNextPatch = true;
  const tooFast = await call('POST', '/branding/banner');
  assert.equal(tooFast.status, 400);
  assert.match(tooFast.json!.errors[0], /не разрешает менять аватар или баннер так часто/);
});

test('каналы и роли: сохранение, чужой канал — ошибка без сохранения, голосовые роли', async () => {
  const saved = await put('channels', {
    channels: { welcome: 'c1', rules: null, auth: '' },
    roles: { guest: 'r1', autorole: null },
    voiceRoles: [{ channelId: 'c3', roleId: 'r1' }, { channelId: '', roleId: '' }, { channelId: 'c3', roleId: 'r1' }],
  });
  assert.equal(saved.status, 200);
  assert.equal(getSettings().channels.welcome, 'c1');
  assert.deepEqual(getSettings().voiceRoles, [{ channelId: 'c3', roleId: 'r1' }], 'пустая строка и повтор отброшены');

  const bad = await put('channels', { channels: { welcome: 'c3' }, roles: {}, voiceRoles: [{ channelId: 'c3', roleId: '' }] });
  assert.equal(bad.status, 400);
  assert.ok(bad.json!.errors.some((e: string) => /Канал приветствия: такого текстового канала нет/.test(e)));
  assert.ok(bad.json!.errors.some((e: string) => /выбери и голосовой канал, и роль/.test(e)));
  assert.equal(getSettings().channels.welcome, 'c1', 'ничего не сохранилось');
});

test('логи, оповещения, приветствие, личка и прощание', async () => {
  const logs = await put('logs', { logs: { raids: { channelId: 'c2', enabled: true }, members: { channelId: 'c1', enabled: false } } });
  assert.equal(logs.status, 200);
  assert.deepEqual(getSettings().logs.raids, { channelId: 'c2', enabled: true });
  assert.deepEqual(getSettings().logs.members, { channelId: 'c1', enabled: false });

  const alerts = await put('alerts', {
    alerts: { channelId: 'c2', roleId: 'r2', lateCancelHours: 2, incidentChannelId: 'c1' },
    raids: { gatherMinutes: 10, attendanceMinutes: 20, attendanceVoiceChannelId: 'c3' },
  });
  assert.equal(alerts.status, 200);
  assert.deepEqual(getSettings().alerts, { channelId: 'c2', roleId: 'r2', lateCancelHours: 2, incidentChannelId: 'c1' });
  assert.equal(getSettings().raids.attendanceVoiceChannelId, 'c3');
  const badAlerts = await put('alerts', { alerts: { lateCancelHours: 2 }, raids: { gatherMinutes: -5, attendanceMinutes: 20, attendanceVoiceChannelId: 'c1' } });
  assert.equal(badAlerts.status, 400);
  assert.ok(badAlerts.json!.errors.some((e: string) => /такого голосового канала нет/.test(e)));

  const welcome = await put('welcome', { welcome: { text: 'Привет, {user}!', guestOffer: 'Роль?', guestButton: 'Взять', rulesButton: 'Правила' } });
  assert.equal(welcome.status, 200);
  assert.equal(getSettings().welcome.text, 'Привет, {user}!');
  assert.equal((await put('welcome', { welcome: { text: ' ' } })).status, 400);

  assert.equal((await put('welcomeDm', { welcomeDm: { enabled: true, text: 'Привет, {name}! Это {server}.' } })).status, 200);
  const dmTest = await call('POST', '/welcome/dm/test');
  assert.match(dmTest.json!.message, /отправлено тебе в личку/);
  assert.equal(dms.at(-1)?.content, 'Привет, Тестер! Это Тест.');

  assert.equal((await put('farewell', { farewell: { channelId: 'c2', text: '{name} уходит' } })).status, 200);
  assert.deepEqual(getSettings().farewell, { channelId: 'c2', text: '{name} уходит' });
  const farewellTest = await call('POST', '/farewell/test');
  assert.equal(farewellTest.status, 400, 'в подставной канал боту писать нельзя');
  assert.match(farewellTest.json!.errors[0], /нельзя писать/);
});

test('расписание рег, липкие сообщения, автоочистка: сохранение и проверки', async () => {
  const raids = structuredClone(getSettings().raids);
  raids.schedules[0]!.channelId = 'c1';
  raids.schedules[0]!.days = [4, 5];
  raids.boardChannelId = 'c2';
  const ok = await put('raids', { raids });
  assert.equal(ok.status, 200);
  assert.deepEqual(getSettings().raids.schedules[0]!.days, [4, 5]);
  raids.schedules[0]!.raidTime = '25:99';
  const bad = await put('raids', { raids });
  assert.equal(bad.status, 400);
  assert.ok(bad.json!.errors.some((e: string) => /время рейда/.test(e)));

  const sticky = await put('sticky', { sticky: { intervalSeconds: 15, items: [{ channelId: 'c1', text: 'Правила' }, { channelId: 'c1', text: '' }] } });
  assert.equal(sticky.status, 400);
  assert.ok(sticky.json!.errors.some((e: string) => /в одном канале может быть только одно/.test(e)));

  assert.equal((await put('autoclean', { autoClean: [{ channelId: 'c2', hours: 48, keepBot: true }] })).status, 200);
  assert.deepEqual(getSettings().autoClean, [{ channelId: 'c2', hours: 48, keepBot: true }]);
  const badClean = await put('autoclean', { autoClean: [{ channelId: 'c2', hours: 0, keepBot: true }] });
  assert.match(badClean.json!.errors.join(), /срок — целое число часов от 1 до 720/);
  assert.equal((await put('nothing', {})).status, 404);
});

test('шаблоны рег: сохранить и создать регу на дату', async () => {
  const saved = await put('templates', { raidTemplates: [{ title: 'Огненные Недра', description: 'Сбор в 19:45', size: 40, time: '20:00', channelId: 'c4', pingRoleId: 'r1' }] });
  assert.equal(saved.status, 200);
  const template = getSettings().raidTemplates[0]!;
  assert.ok(template.id);

  const tomorrow = Temporal.Now.plainDateISO('Europe/Kyiv').add({ days: 1 }).toString();
  const created = await call('POST', `/templates/${template.id}/create`, { date: tomorrow, time: '21:00' });
  assert.equal(created.status, 200);
  assert.match(created.json!.message, /Рега #\d+ «Огненные Недра» создана в #опросы/);
  assert.match(created.json!.url, /^https:\/\/discord\.com\/channels\/g1\/c4\//);
  assert.match(String(posts.at(-1)?.content), /<@&r1>/);
  assert.equal(listRaids('g1', 'open')[0]!.leaderName, 'Тестер');

  assert.match((await call('POST', `/templates/${template.id}/create`, { date: '2020-01-01' })).json!.errors[0], /уже прошло/);
  assert.equal((await call('POST', '/templates/nope/create', { date: tomorrow })).status, 404);
});

test('опросы: шаблон, проверка, публикация с картинкой, итоги по людям, CSV, копия, закрытие', async () => {
  assert.match((await call('GET', '/polls/template')).json!.source, /Warcraft Forever — формат гильдии/);

  const broken = (await call('POST', '/polls/check', { source: '# Опрос\n\n### Вопрос без страницы' })).json!;
  assert.match(broken.errors[0], /^Строка 3: вопрос должен быть внутри блока/);
  const source = '# Рейды осенью\n\n## Дни\n\n### Какие дни удобны? *\n[ ] Четверг\n[ ] Пятница\n\n### Пожелания\nОтвет: длинный\n';
  const checked = (await call('POST', '/polls/check', { source })).json!;
  assert.deepEqual([checked.errors, checked.preview.title, checked.questions], [[], 'Рейды осенью', 2]);

  const noChannel = new FormData();
  noChannel.append('source', source);
  assert.match((await call('POST', '/polls', noChannel)).json!.errors[0], /Выбери канал/);

  const form = new FormData();
  form.append('source', source);
  form.append('channel', 'c4');
  form.append('role', 'r1');
  form.append('image', new File([new Uint8Array([137, 80, 78, 71])], 'осень.png', { type: 'image/png' }));
  const published = await call('POST', '/polls', form);
  assert.equal(published.status, 200);
  const id = published.json!.id as number;
  assert.equal(getPoll(id)!.source, source);
  assert.equal((posts.at(-1)?.files ?? []).length, 1, 'картинка вложением');

  saveResponse(id, '20', { answers: { q1: ['o1', 'o2'], q2: ['Пораньше бы'] }, done: [0] }, true);
  saveResponse(id, '21', { answers: { q1: ['o2'] }, done: [0] }, false);
  const results = (await call('GET', `/polls/${id}`)).json!;
  assert.deepEqual([results.stats.total, results.stats.completed], [2, 1]);
  assert.deepEqual(results.stats.questions[0].options.map((o: { percent: number }) => o.percent), [50, 100]);
  assert.equal(results.names['20'], 'Тестер (@tester)');
  assert.equal(results.respondents[0].answers[0].answer, 'Четверг; Пятница');

  const csv = (await call('GET', `/polls/${id}/csv`)).res;
  assert.deepEqual([...Buffer.from(await csv.arrayBuffer()).subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.deepEqual((await call('GET', `/polls/${id}/source`)).json, { source, channelId: 'c4', roleId: 'r1' });

  assert.match((await call('POST', `/polls/${id}/close`)).json!.message, /Опрос закрыт/);
  assert.equal(getPoll(id)!.closed, true);
  assert.equal(edits.length, 1);

  const anonymous = createPoll('g1', 'c4', { ...getPoll(id)!.definition, anonymous: true }, 'u');
  assert.equal((await call('GET', `/polls/${anonymous.id}`)).json!.respondents, null);
  assert.equal((await call('GET', `/polls/${createPoll('чужой', 'x', getPoll(id)!.definition, 'u').id}`)).status, 404);
  assert.equal((await call('GET', '/polls')).json!.length, 2);
});

test('посещаемость за период', async () => {
  const raid = createRaid({ guildId: 'g1', channelId: 'c4', title: 'Проверка посещаемости', startsAt: Date.now() - 86_400_000, size: 40, createdBy: ADMIN });
  upsertSignup(raid.id, '20', 'mage_fire', 'Тестер');
  saveAttendance(raid.id, [{ userId: '20', status: 'present' }]);
  markAttendanceDone(raid.id);
  const data = (await call('GET', '/attendance')).json!;
  assert.equal(data.checked, 1);
  assert.deepEqual([data.rows[0].name, data.rows[0].rate], ['Тестер (@tester)', 100]);
  assert.deepEqual((await call('GET', '/attendance?from=2020-01-01&to=2020-01-31')).json!.rows, []);
});
