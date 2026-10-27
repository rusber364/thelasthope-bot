import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GeminiReply, GeminiRequest } from './gemini.ts';
import type { Person } from './memory.ts';

process.env.BOT_DB_PATH = ':memory:';
const { callsByName, triggerOf } = await import('./triggers.ts');
const { buildContents, cleanReply, lineText, textToolCall } = await import('./context.ts');
const { FALLBACK_MODEL, GeminiError, ModelRest, RETRY_DELAY_MS, generate, generateSteady, parseResponse, readyModels, requestBody, restMs } = await import('./gemini.ts');
const { onMessage, resetSveta, svetaInviteUrl } = await import('./index.ts');
const { TOOLS, guildSummary, runTool } = await import('./tools.ts');
const { newsText } = await import('./news.ts');
const { SCOLD_LINES } = await import('./swearing.ts');
const { createRaid, upsertSignup, setTentative } = await import('../raids/store.ts');
const { requestsOn, dayKey, spendSince } = await import('./limits.ts');
const { getSettings, saveSettings, validateSettings } = await import('../botSettings.ts');

test('по имени Света отзывается на обращение, но не на «свет погас» и «мало света»', () => {
  for (const text of ['Света, когда рейд?', 'света привет', 'Свет, глянь', 'Светик!', 'а ты что скажешь, Света?', 'привет света', '«Светочка», помоги']) {
    assert.ok(callsByName(text), text);
  }
  for (const text of ['Свет погас в данже', 'в рейде мало света', 'светлый паладин', 'Светлячок', 'рассвет']) {
    assert.ok(!callsByName(text), text);
  }
});

test('когда отвечать: упоминание, ответ на её сообщение, имя; сама — редко и не на «ок»; боты и чужие каналы — нет', () => {
  const base = { authorIsBot: false, channelId: 'C', content: 'обычная болтовня про рейд', mentionsSveta: false, replyToSveta: false };
  const ask = (patch: Partial<typeof base>, roll = 0.99) => triggerOf({ ...base, ...patch }, ['C'], 5, roll);
  assert.equal(ask({ mentionsSveta: true }), 'mention');
  assert.equal(ask({ replyToSveta: true }), 'reply');
  assert.equal(ask({ content: 'Света, привет' }), 'name');
  assert.equal(ask({}), null);
  assert.equal(ask({}, 0.01), 'random', 'выпал шанс 5%');
  assert.equal(ask({ content: 'ок' }, 0.01), null, 'на короткие не встревает');
  assert.equal(ask({ mentionsSveta: true, authorIsBot: true }), null);
  assert.equal(ask({ mentionsSveta: true, channelId: 'X' }), null, 'не её канал');
});

test('переписка для модели: люди — «Имя: текст» и склеиваются, реплики Светы — от модели, начало — с людей', () => {
  const contents = buildContents([
    { name: 'Света', text: 'старая реплика', fromSveta: true },
    { name: 'Вася', text: 'вайпнулись опять', fromSveta: false },
    { name: 'Петя', text: lineText('', 1, 0), fromSveta: false },
    { name: 'Света', text: 'танк убежал?', fromSveta: true },
    { name: 'Вася', text: 'Света, ну скажи', fromSveta: false },
    { name: 'Пустой', text: '   ', fromSveta: false },
  ]);
  assert.deepEqual(contents, [
    { role: 'user', parts: [{ text: 'Вася: вайпнулись опять\nПетя: [картинка или файл]' }] },
    { role: 'model', parts: [{ text: 'танк убежал?' }] },
    { role: 'user', parts: [{ text: 'Вася: Света, ну скажи' }] },
  ]);
  assert.equal(cleanReply('**Света:** Привет всем, @everyone!'), 'Привет всем, @​everyone!');
  assert.equal(cleanReply('а'.repeat(3000)).length, 1900);
});

test('запрос к Gemini: характер в systemInstruction, мягкие фильтры, у Gemini 3 — низкое «обдумывание», у 2.x — без него', () => {
  const body = requestBody({ model: 'gemini-flash-latest', system: 'Ты — Света', contents: [{ role: 'user', parts: [{ text: 'привет' }] }] });
  assert.equal(body.systemInstruction.parts[0]!.text, 'Ты — Света');
  assert.ok(body.safetySettings.every((s) => s.threshold === 'BLOCK_ONLY_HIGH'));
  assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingLevel: 'LOW' });
  const deep = requestBody({ model: 'gemini-flash-latest', system: '', contents: [], thinking: 'medium' });
  assert.deepEqual(deep.generationConfig.thinkingConfig, { thinkingLevel: 'MEDIUM' }, 'уровень из админки');
  const old = requestBody({ model: 'gemini-2.5-flash', system: '', contents: [], thinking: 'high' });
  assert.equal('thinkingConfig' in old.generationConfig, false);
  assert.equal('tools' in old, false, 'без инструментов — без tools');
  const withTools = requestBody({ model: 'gemini-flash-latest', system: '', contents: [], tools: TOOLS, toolMode: 'NONE' });
  assert.deepEqual(withTools.tools?.[0]?.functionDeclarations.map((t) => t.name), ['upcoming_raids', 'raid_roster', 'raid_schedule']);
  assert.deepEqual(withTools.toolConfig, { functionCallingConfig: { mode: 'NONE' } });
});

test('ответ Gemini: текст без «мыслей»; 429 — лимит, неверный ключ, нет модели, фильтр — понятные ошибки', () => {
  const ok = parseResponse(200, {
    candidates: [{ content: { parts: [{ text: 'думаю…', thought: true }, { text: 'Привет, ' }, { text: 'рейдер!' }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 60, totalTokenCount: 77 },
  });
  assert.equal(ok.text, 'Привет, рейдер!');
  assert.deepEqual(ok.usage, { input: 60, output: 17, cost: null }, 'выход — всё, кроме запроса (с «мыслями»)');
  assert.deepEqual(ok.calls, []);

  // Вызов инструмента: имя, аргументы, id — и ответ модели целиком (с подписью мыслей) для следующего запроса.
  const call = parseResponse(200, {
    candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'raid_roster', args: { raid_id: 3 }, id: 'c1' }, thoughtSignature: 'sig' }] } }],
  });
  assert.deepEqual(call.calls, [{ name: 'raid_roster', args: { raid_id: 3 }, id: 'c1' }]);
  assert.deepEqual(call.content, { role: 'model', parts: [{ functionCall: { name: 'raid_roster', args: { raid_id: 3 }, id: 'c1' }, thoughtSignature: 'sig' }] });

  const kind = (status: number, json: object) => {
    try {
      parseResponse(status, json);
      return 'ok';
    } catch (error) {
      return error instanceof GeminiError ? error.kind : 'other';
    }
  };
  assert.equal(kind(429, { error: { status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded' } }), 'quota');
  assert.equal(kind(400, { error: { message: 'API key not valid. Please pass a valid API key.', details: [{ reason: 'API_KEY_INVALID' }] } }), 'auth');
  assert.equal(kind(404, { error: { message: 'models/x is not found' } }), 'model');
  assert.equal(kind(200, { promptFeedback: { blockReason: 'SAFETY' } }), 'blocked');
  assert.equal(kind(200, { candidates: [{ finishReason: 'SAFETY' }] }), 'blocked');
  // 429: в минуту или в день — по имени квоты; дневной тоже присылает «повтори через N секунд».
  const limit = (quotaId: string, retryDelay: string) => ({
    error: {
      status: 'RESOURCE_EXHAUSTED',
      message: 'You exceeded your current quota.',
      details: [
        { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId }] },
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay },
      ],
    },
  });
  assert.equal(kind(429, limit('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', '37s')), 'rate');
  assert.equal(kind(429, limit('GenerateRequestsPerDayPerProjectPerModel-FreeTier', '6s')), 'quota');
  assert.equal(kind(429, { error: { message: 'Resource exhausted. Please retry in 12.5s.' } }), 'rate');
  try {
    parseResponse(429, limit('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', '37.2s'));
  } catch (error) {
    assert.equal((error as InstanceType<typeof GeminiError>).retryMs, 37_200);
  }
  assert.equal(kind(500, {}), 'busy');
  assert.equal(kind(503, { error: { status: 'UNAVAILABLE', message: 'This model is currently experiencing high demand.' } }), 'busy', 'перегрузка');
  assert.equal(kind(400, { error: { message: 'Invalid argument' } }), 'unavailable');
});

test('generate: ключ — в заголовке, а не в адресе; модель — в адресе', async () => {
  const realFetch = globalThis.fetch;
  let seen: { url: string; key: string | null } | null = null;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen = { url, key: new Headers(init.headers).get('x-goog-api-key') };
    return Response.json({ candidates: [{ content: { parts: [{ text: 'ок' }] } }] });
  }) as typeof fetch;
  try {
    const reply = await generate({ apiKey: 'secret', model: 'gemini-flash-latest', system: 's', contents: [] });
    assert.equal(reply.text, 'ок');
    assert.equal(seen!.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent');
    assert.equal(seen!.key, 'secret');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('настройки: включённой Свете нужен канал, модель — без пробелов, потолки в пределах', () => {
  const s = structuredClone(getSettings());
  s.sveta = { ...s.sveta, enabled: true, channelIds: [], model: 'gemini flash', perHour: 0 };
  const errors = validateSettings(s).join('\n');
  assert.match(errors, /выбери хотя бы один канал/);
  assert.match(errors, /модель/);
  assert.match(errors, /ответов в час: целое число от 1/);
  assert.match(svetaInviteUrl('123'), /client_id=123&scope=bot&permissions=68672$/, 'только видеть, писать, читать историю и реакции');
});

// --- Ответ в канале: подставное сообщение Discord и подставной Gemini ---

const replies: { content: string; allowedMentions: { repliedUser?: boolean } }[] = [];
const requests: GeminiRequest[] = [];
type Answer = GeminiReply;
const say = (text: string): Answer => ({ text, usage: { input: 30, output: 12, cost: null }, calls: [], content: { role: 'model', parts: [{ text }] } });
let geminiAnswer: () => Promise<Answer> = async () => say('Света: Привет, Морозко! 👋');
let clock = Date.UTC(2026, 9, 19, 18, 0);
let roll = 0.99;
const waits: number[] = [];
const deps = {
  generate: async (request: GeminiRequest) => {
    requests.push(request);
    return geminiAnswer();
  },
  now: () => clock,
  random: () => roll,
  apiKey: () => 'key' as string | undefined,
  openrouterKey: () => 'or-key' as string | undefined,
  wait: async (ms: number) => void waits.push(ms),
};

const earlier = new Map([['m0', { id: 'm0', author: { id: 'S', displayName: 'Света' }, member: null, cleanContent: 'Кто сегодня танкует?', attachments: { size: 0 }, stickers: { size: 0 } }]]);
function message(content: string, { userId = 'u1', channelId = 'C', bot = false, mention = false, roleMention = false, guildId = 'T', canWrite = true } = {}) {
  const msg = {
    id: `m${Math.random()}`,
    content,
    cleanContent: content,
    channelId,
    guildId,
    client: { user: { id: 'S' } },
    author: { id: userId, bot, displayName: 'Морозко' },
    member: { displayName: 'Морозко' },
    guild: { name: 'The Last Hope', members: { me: { id: 'S' } } },
    attachments: { size: 0 },
    stickers: { size: 0 },
    mentions: {
      users: new Map(mention ? [['S', {}]] : []),
      // Роль бота «Sveta» (managed): tags.botId — это Света.
      roles: { some: (fn: (role: { tags?: { botId?: string } }) => boolean) => (roleMention ? [{ tags: { botId: 'S' } }] : []).some(fn) },
      repliedUser: null,
    },
    channel: {
      name: 'таверна',
      sendTyping: async () => {},
      messages: { fetch: async () => earlier },
      isThread: () => false,
      // Права Светы в канале: писать и читать историю (нужно, чтобы ворчать вне её каналов).
      permissionsFor: () => ({ has: () => canWrite }),
    },
    inGuild: () => true,
    // Света отвечает и на уже удалённое сообщение — без привязки (failIfNotExists: false), а не с ошибкой Discord.
    reply: async ({ failIfNotExists, ...payload }: (typeof replies)[number] & { failIfNotExists?: boolean }) => {
      assert.equal(failIfNotExists, false);
      replies.push(payload);
    },
  };
  return msg as never;
}

function configure(patch: Partial<ReturnType<typeof getSettings>['sveta']> = {}) {
  const s = structuredClone(getSettings());
  s.sveta = { ...s.sveta, enabled: true, channelIds: ['C'], userCooldownSeconds: 15, perHour: 40, perDay: 300, randomPercent: 2, ...patch };
  saveSettings(s);
  resetSveta();
  replies.length = 0;
  requests.length = 0;
  waits.length = 0;
  geminiAnswer = async () => say('Света: Привет, Морозко! 👋');
  clock += 24 * 60 * 60 * 1000; // новый день — дневной счётчик с нуля
}

test('позвали по имени: Света видит переписку, отвечает реплаем без упоминаний и без «Света:»', async () => {
  configure();
  await onMessage(message('Света, привет!'), deps);
  assert.equal(requests.length, 1);
  const request = requests[0]!;
  assert.equal(request.model, 'gemini-flash-latest');
  assert.match(request.system, /Ты — Света/);
  assert.match(request.system, /The Last Hope/);
  assert.match(request.system, /Открытых рег сейчас нет/, 'сводка сборов — в инструкции');
  assert.deepEqual(
    request.contents.map((c) => `${c.role}: ${c.parts[0]!.text}`),
    ['user: Морозко: Света, привет!'],
    'её старая реплика в начале отброшена — переписка начинается с людей',
  );
  assert.deepEqual(replies, [{ content: 'Привет, Морозко! 👋', allowedMentions: { parse: [], repliedUser: true } }]);
});

test('выключена, чужой канал, бот или просто болтовня — Света молчит и в Gemini ничего не уходит', async () => {
  configure({ enabled: false });
  await onMessage(message('Света, привет!'), deps);
  configure();
  await onMessage(message('Света, привет!', { channelId: 'X' }), deps);
  await onMessage(message('Света, привет!', { bot: true }), deps);
  await onMessage(message('обычная болтовня про рейд'), deps);
  assert.equal(requests.length, 0);
  assert.equal(replies.length, 0);
});

test('пауза для одного человека и потолок в час: позвавшему — «перерыв» один раз в час', async () => {
  configure({ perHour: 2 });
  await onMessage(message('Света, раз'), deps);
  await onMessage(message('Света, два'), deps);
  assert.equal(requests.length, 1, 'тот же человек сразу — пауза 15 секунд');

  clock += 20_000;
  await onMessage(message('Света, три', { userId: 'u2' }), deps);
  await onMessage(message('Света, четыре', { userId: 'u3' }), deps);
  await onMessage(message('Света, пять', { userId: 'u4' }), deps);
  assert.equal(requests.length, 2, 'потолок 2 в час');
  assert.deepEqual(replies.map((r) => r.content).slice(-1), ['Дайте Свете передохнуть, через часик вернусь ☕']);
  assert.equal(replies.filter((r) => r.content.includes('передохнуть')).length, 1, '«перерыв» — один раз');
});

test('Gemini: лимит исчерпан — «перерыв» и час тишины; фильтр — отшучивается; встряла сама — без уведомления', async () => {
  configure();
  geminiAnswer = async () => {
    throw new GeminiError('quota', 'Quota exceeded');
  };
  await onMessage(message('Света, привет'), deps);
  assert.deepEqual(replies.map((r) => r.content), ['Я на перерыве 💤 Загляну попозже.']);
  assert.deepEqual(requests.map((r) => r.model), ['gemini-flash-latest', FALLBACK_MODEL], 'у лёгкой модели свой лимит — попробовала и её');
  clock += 30 * 60 * 1000;
  await onMessage(message('Света, ау', { userId: 'u2' }), deps);
  assert.equal(requests.length, 2, 'полчаса спустя — всё ещё на перерыве, в Gemini не стучимся');
  clock += 31 * 60 * 1000;
  geminiAnswer = async () => say('Я тут!');
  await onMessage(message('Света, ау', { userId: 'u3' }), deps);
  assert.equal(replies.at(-1)?.content, 'Я тут!', 'через час пробует снова');

  configure();
  geminiAnswer = async () => {
    throw new GeminiError('blocked', 'SAFETY');
  };
  await onMessage(message('Света, скажи гадость'), deps);
  assert.equal(replies.at(-1)?.content, 'Не-не, такое я обсуждать не буду 😅');

  configure();
  geminiAnswer = async () => {
    throw new GeminiError('unavailable', 'The operation was aborted due to timeout');
  };
  await onMessage(message('Света, ты тут?'), deps);
  assert.deepEqual(requests.map((r) => r.model), ['gemini-flash-latest', FALLBACK_MODEL], 'сначала попробовала лёгкую модель');
  assert.equal(replies.at(-1)?.content, 'Что-то я задумалась 🤔 Спроси ещё раз чуть позже.', 'Google не ответил — позвавший не ждёт в тишине');

  configure({ randomPercent: 20 });
  roll = 0.01;
  await onMessage(message('кто-нибудь знает, когда патч выйдет?'), deps);
  roll = 0.99;
  assert.equal(replies.at(-1)?.allowedMentions.repliedUser, false, 'встряла сама — автору без уведомления');
});

// --- Этап 2: сборы ---

const start = Date.now() + 3 * 24 * 60 * 60 * 1000;
const raid = createRaid({ guildId: 'G', channelId: 'R', title: 'Огненные Недра', startsAt: start, size: 2, createdBy: 'o', limits: { tank: 1, healer: null, dps: null } });
upsertSignup(raid.id, 'a', 'warrior_prot', 'Проттоварыч');
upsertSignup(raid.id, 'b', 'paladin_prot', 'Второй Танк');
upsertSignup(raid.id, 'c', 'mage_fire', 'Морозко');
upsertSignup(raid.id, 'd', 'priest_holy', 'Холистар');
setTentative(raid.id, 'd', true);
createRaid({ guildId: 'OTHER', channelId: 'R', title: 'Чужой рейд', startsAt: start, size: 10, createdBy: 'o' });

test('сводка сборов: номер, вид, когда, сколько в основе и запасе; чужой сервер не попадает', () => {
  const summary = guildSummary('G');
  assert.match(summary, new RegExp(`^- #${raid.id} Рейд «Огненные Недра» — .+, в основе 2 из 2, в запасе 1, под вопросом 1$`));
  assert.doesNotMatch(summary, /Чужой/);
  assert.equal(guildSummary('NOBODY'), 'Открытых рег сейчас нет.');
});

test('инструменты: состав по ролям со спеками, запас и «под вопросом»; чужая рега — «нет такой»; расписание из шаблонов', () => {
  const roster = runTool('raid_roster', { raid_id: raid.id }, 'G') as { main: Record<string, string[]>; bench: string[]; tentative: string[]; status: string };
  assert.deepEqual(roster.main['Танки'], ['Проттоварыч (Воин — Защита)']);
  assert.deepEqual(roster.main['Дальний бой'], ['Морозко (Маг — Огонь)']);
  assert.deepEqual(roster.bench, ['Второй Танк (Паладин — Защита)'], 'второй танк — в запасе по лимиту');
  assert.deepEqual(roster.tentative, ['Холистар (Жрец — Свет)']);
  assert.equal(roster.status, 'запись открыта');
  assert.deepEqual(runTool('raid_roster', { raid_id: raid.id }, 'OTHER'), { error: 'Нет такой реги.' });

  const list = runTool('upcoming_raids', { kind: 'dungeon' }, 'G') as { raids: unknown[] };
  assert.deepEqual(list.raids, [], 'подземелий нет');
  assert.equal((runTool('upcoming_raids', {}, 'G') as { raids: { title: string }[] }).raids[0]?.title, 'Огненные Недра');

  const settings = structuredClone(getSettings());
  settings.raidTemplates = [{ ...settings.raidTemplates[0]!, channelId: 'R', title: 'Основа', slots: [{ raidDay: 4, raidTime: '20:00', openDay: 4, openTime: '00:00' }] }];
  saveSettings(settings);
  assert.deepEqual(runTool('raid_schedule', {}, 'G'), { templates: [{ title: 'Основа', kind: 'Рейд', times: ['Чт 20:00, рега открывается: Чт 00:00'] }] });
  assert.match(String((runTool('nope', {}, 'G') as { error: string }).error), /Нет такого инструмента/);
});

test('Света спрашивает состав инструментом: ответ модели возвращается целиком, на вызов — результат с тем же id, запросов — 2', async () => {
  configure();
  const calls: Answer[] = [
    { text: '', usage: null, calls: [{ name: 'raid_roster', args: { raid_id: raid.id }, id: 'call-1' }], content: { role: 'model', parts: [{ functionCall: { name: 'raid_roster', args: { raid_id: raid.id }, id: 'call-1' }, thoughtSignature: 'sig' }] } },
    say('Танкует Проттоварыч, второй танк в запасе 🛡️'),
  ];
  geminiAnswer = async () => calls.shift()!;
  await onMessage(message('Света, кто танкует в Недрах?', { guildId: 'G' }), deps);

  assert.equal(requests.length, 2);
  assert.equal(requests[0]!.toolMode, 'AUTO');
  const second = requests[1]!.contents;
  assert.deepEqual(second.at(-2), { role: 'model', parts: [{ functionCall: { name: 'raid_roster', args: { raid_id: raid.id }, id: 'call-1' }, thoughtSignature: 'sig' }] });
  const response = (second.at(-1)!.parts[0] as { functionResponse: { name: string; id: string; response: { result: { main: Record<string, string[]> } } } }).functionResponse;
  assert.equal(response.name, 'raid_roster');
  assert.equal(response.id, 'call-1');
  assert.deepEqual(response.response.result.main['Танки'], ['Проттоварыч (Воин — Защита)']);
  assert.equal(replies.at(-1)?.content, 'Танкует Проттоварыч, второй танк в запасе 🛡️');
  assert.equal(requestsOn(dayKey(clock)), 2, 'Google считает запросы — и мы тоже');
});

test('инструменты не бесконечны: после двух кругов — запрос без инструментов, только текст', async () => {
  configure();
  const loop: Answer = { text: '', usage: null, calls: [{ name: 'upcoming_raids', args: {} }], content: { role: 'model', parts: [{ functionCall: { name: 'upcoming_raids', args: {} } }] } };
  let n = 0;
  geminiAnswer = async () => (++n < 3 ? loop : say('Вот что есть 📜'));
  await onMessage(message('Света, что по сборам?'), deps);
  assert.deepEqual(requests.map((r) => r.toolMode), ['AUTO', 'AUTO', 'NONE']);
  assert.equal(replies.at(-1)?.content, 'Вот что есть 📜');
});

test('сбой Google: перегрузка — повтор через 2 с, потом лёгкая модель; таймаут и лимит — сразу лёгкая; ключ и фильтр — без повторов', async () => {
  const run = async (errors: (string | null)[], model = 'gemini-flash-latest', rest = new ModelRest(), now = 0) => {
    const tried: string[] = [];
    const paused: number[] = [];
    const queue = [...errors];
    const steady = {
      generate: async (request: GeminiRequest) => {
        const kind = queue.shift();
        if (kind) throw new GeminiError(kind as 'busy', kind, kind === 'rate' ? 30_000 : null);
        return say(`ответила ${request.model}`);
      },
      wait: async (ms: number) => void paused.push(ms),
      now: () => now,
      rest,
      onAttempt: (m: string) => void tried.push(m),
      onFailure: () => {},
      fallback: FALLBACK_MODEL,
      keyFor: () => 'k',
    };
    try {
      const { reply, model: used } = await generateSteady({ apiKey: 'k', model, system: 's', contents: [] }, steady);
      return { result: reply.text, used, tried, paused };
    } catch (error) {
      return { result: `ошибка ${(error as InstanceType<typeof GeminiError>).kind}`, tried, paused };
    }
  };
  const main = 'gemini-flash-latest';
  const lite = FALLBACK_MODEL;

  assert.deepEqual(await run([]), { result: `ответила ${main}`, used: main, tried: [main], paused: [] });
  assert.deepEqual(await run(['busy']), { result: `ответила ${main}`, used: main, tried: [main, main], paused: [RETRY_DELAY_MS] });
  assert.deepEqual(await run(['busy', 'busy']), { result: `ответила ${lite}`, used: lite, tried: [main, main, lite], paused: [RETRY_DELAY_MS] });
  assert.deepEqual(await run(['unavailable']), { result: `ответила ${lite}`, used: lite, tried: [main, lite], paused: [] }, 'после таймаута основную второй раз не ждём');
  assert.deepEqual(await run(['rate']), { result: `ответила ${lite}`, used: lite, tried: [main, lite], paused: [] }, 'лимит у каждой модели свой');
  assert.deepEqual(await run(['quota']), { result: `ответила ${lite}`, used: lite, tried: [main, lite], paused: [] });
  assert.deepEqual(
    await run(['busy', 'busy', 'busy', 'busy']),
    { result: 'ошибка busy', tried: [main, main, lite, lite], paused: [RETRY_DELAY_MS, RETRY_DELAY_MS] },
    'лёгкая тоже лежит (и её повтор) — сдаёмся',
  );
  assert.deepEqual(await run(['busy', 'busy'], lite), { result: 'ошибка busy', tried: [lite, lite], paused: [RETRY_DELAY_MS] }, 'основная и есть лёгкая — только повтор');
  assert.deepEqual(await run(['auth']), { result: 'ошибка auth', tried: [main], paused: [] });
  assert.deepEqual(await run(['blocked']), { result: 'ошибка blocked', tried: [main], paused: [] });

  // Модель, которая подвела, отдыхает: следующие запросы сразу к другой, лимит и время зря не тратятся.
  const busy = new ModelRest();
  await run(['busy', 'busy'], main, busy, 0);
  assert.deepEqual((await run([], main, busy, 60_000)).tried, [lite], 'перегружена — 5 минут сразу к лёгкой');
  assert.deepEqual((await run([], main, busy, 5 * 60_000)).tried, [main], 'через 5 минут — снова основная');
  const rate = new ModelRest();
  await run(['rate'], main, rate, 0);
  assert.deepEqual((await run([], main, rate, 20_000)).tried, [lite], 'лимит в минуту — ждём, сколько сказал Google (30 с)');
  assert.deepEqual((await run([], main, rate, 30_000)).tried, [main]);
  const daily = new ModelRest();
  await run(['quota', 'quota'], main, daily, 0);
  assert.deepEqual(readyModels([main, lite], daily, 59 * 60_000), [], 'дневной лимит у обеих — час тишины');
  assert.deepEqual(await run([], main, daily, 59 * 60_000), { result: 'ошибка rate', tried: [], paused: [] }, 'все отдыхают — в Gemini не стучимся');
  assert.deepEqual(readyModels([main, lite], daily, 60 * 60_000), [main, lite]);
  assert.equal(restMs(new GeminiError('rate', 'x', 999_000)), 5 * 60_000, 'больше 5 минут на лимит в минуту не ждём');
});

test('Gemini перегружен: Света отвечает лёгкой моделью, второй круг инструментов — к ней же; запросы считаются все', async () => {
  configure();
  const queue: (Answer | 'busy')[] = [
    'busy',
    'busy',
    { text: '', usage: null, calls: [{ name: 'upcoming_raids', args: {} }], content: { role: 'model', parts: [{ functionCall: { name: 'upcoming_raids', args: {} } }] } },
    say('Сборов пока нет 📜'),
  ];
  geminiAnswer = async () => {
    const next = queue.shift()!;
    if (next === 'busy') throw new GeminiError('busy', 'This model is currently experiencing high demand.');
    return next;
  };
  await onMessage(message('Света, что по сборам?'), deps);
  assert.deepEqual(
    requests.map((r) => r.model),
    ['gemini-flash-latest', 'gemini-flash-latest', FALLBACK_MODEL, FALLBACK_MODEL],
  );
  assert.deepEqual(waits, [RETRY_DELAY_MS]);
  assert.equal(replies.at(-1)?.content, 'Сборов пока нет 📜');
  assert.equal(requestsOn(dayKey(clock)), 4);

  // Пока основная отдыхает (5 минут) — сразу лёгкая: без повторов и пауз, запрос один.
  requests.length = 0;
  clock += 60_000;
  geminiAnswer = async () => say('Привет-привет!');
  await onMessage(message('Света, привет', { userId: 'u2' }), deps);
  assert.deepEqual(requests.map((r) => r.model), [FALLBACK_MODEL]);
  clock += 5 * 60_000;
  await onMessage(message('Света, привет', { userId: 'u3' }), deps);
  assert.equal(requests.at(-1)?.model, 'gemini-flash-latest', 'через 5 минут — снова основная');
});

test('новости о сборах: заготовленные фразы со ссылкой на регу; при отмене — без ссылки', () => {
  const published = { ...raid, messageId: 'M' };
  const open = newsText('open', published, 0);
  assert.match(open, /Открылась рега: Рейд \*\*Огненные Недра\*\* — <t:\d+:F>/);
  assert.match(open, new RegExp(`https://discord.com/channels/G/R/M$`));
  assert.match(newsText('gather', published, 0.99), /Сбор! Рейд \*\*Огненные Недра\*\* <t:\d+:R>/);
  assert.match(newsText('move', published, 0), /перенесли: теперь <t:\d+:F>/);
  const cancel = newsText('cancel', published, 0);
  assert.match(cancel, /отменили/);
  assert.doesNotMatch(cancel, /discord\.com/);
  assert.match(newsText('cancel', published, 0.99), /^Отбой: рейд \*\*Огненные Недра\*\* не состоится/);
});

// --- Этап 3: память о людях ---

const memory = await import('./memory.ts');

test('память: шаг отношения не больше ±20 и предел ±100; заметки без упоминаний, не длиннее 200, хранятся последние 30', () => {
  const t = 1_000;
  assert.equal(memory.changeAttitude('M', 'p1', 'Вася', 50, t).attitude, 20, 'за раз — не больше 20');
  for (let i = 0; i < 10; i++) memory.changeAttitude('M', 'p1', 'Вася', 20, t);
  assert.equal(memory.getPerson('M', 'p1')!.attitude, 100);
  assert.equal(memory.changeAttitude('M', 'p1', 'Вася', -500, t).attitude, 80);

  memory.addNote('M', 'p1', 'Вася', 'зовёт <@123> и @everyone   в рейд', t);
  assert.equal(memory.getPerson('M', 'p1')!.notes[0]!.text, 'зовёт и everyone в рейд');
  for (let i = 0; i < 32; i++) memory.addNote('M', 'p1', 'Вася', `заметка ${i}`, t + i);
  const notes = memory.getPerson('M', 'p1')!.notes;
  assert.equal(notes.length, 30);
  assert.equal(notes.at(-1)!.text, 'заметка 31');
  assert.equal(memory.addNote('M', 'p1', 'Вася', 'а'.repeat(500), t)!.notes.at(-1)!.text.length, 200);
  assert.equal(memory.setNickname('M', 'p1', 'Вася', 'Беглый танк '.repeat(5), t).nickname!.length, 32);

  assert.equal(memory.forgetPerson('M', 'p1'), true);
  assert.equal(memory.getPerson('M', 'p1'), null);
  assert.equal(memory.forgetPerson('M', 'p1'), false);
});

test('«что ты обо мне помнишь» и «забудь меня» распознаются; отчёт — ровно то, что в памяти', () => {
  assert.equal(memory.memoryCommand('Света, что ты обо мне помнишь?'), 'ask');
  assert.equal(memory.memoryCommand('света что знаешь про меня'), 'ask');
  assert.equal(memory.memoryCommand('Света, забудь меня'), 'forget');
  assert.equal(memory.memoryCommand('Света, забудь всё обо мне!'), 'forget');
  assert.equal(memory.memoryCommand('Света, что думаешь про рейд?'), null);

  assert.equal(memory.memoryReport(null), 'Пока ничего — мы почти не знакомы 🙂');
  const report = memory.memoryReport({
    guildId: 'M',
    userId: 'p',
    name: 'Вася',
    attitude: -35,
    nickname: 'Беглый танк',
    notes: [{ at: 0, text: 'убежал с пулла' }],
    reasons: [{ at: 0, change: -15, text: 'дразнит хилов' }],
    firstSeen: Date.UTC(2026, 9, 19, 12),
    lastSeen: Date.UTC(2026, 9, 20, 12),
    talks: 4,
    updatedAt: 0,
  });
  assert.match(report, /Отношение: -35 — недолюбливаю/);
  assert.match(report, /Прозвище: «Беглый танк»/);
  assert.match(report, /Знакомы с 19 окт\., разговоров: 4/);
  assert.match(report, /• обидело: дразнит хилов/);
  assert.match(report, /• .+: убежал с пулла/);
  assert.match(memory.dossiers([], { now: 0 }), /пока ничего не помнишь/);

  const bad = memory.personInput({ attitude: 150, nickname: 'x'.repeat(40), notes: Array.from({ length: 31 }, () => 'n') });
  assert.equal(bad.errors.length, 3);
  const good = memory.personInput({ attitude: -10, nickname: ' Танк ', notes: ['любит друида', ''] });
  assert.deepEqual(good, { errors: [], attitude: -10, nickname: 'Танк', notes: ['любит друида'] });
});

test('Света и память: «что помнишь» и «забудь меня» — без Gemini; запись — только об авторе, без второго запроса; досье — в инструкции', async () => {
  configure();
  memory.forgetPerson('T', 'u7');
  await onMessage(message('Света, что ты обо мне помнишь?', { userId: 'u7' }), deps);
  assert.equal(requests.length, 0, 'в Gemini ничего не ушло');
  assert.equal(replies.at(-1)?.content, 'Пока ничего — мы почти не знакомы 🙂');

  // Модель ответила текстом и сразу записала в память — второй запрос не нужен.
  geminiAnswer = async () => ({
    text: 'Ах так? Запомню 😤',
    usage: null,
    calls: [
      { name: 'change_attitude', args: { change: -15, reason: 'назвал Свету железякой' }, id: 'a' },
      { name: 'set_nickname', args: { nickname: 'Обидчик' }, id: 'b' },
    ],
    content: { role: 'model', parts: [] },
  });
  await onMessage(message('Света, ты просто железяка', { userId: 'u7' }), deps);
  assert.equal(requests.length, 1);
  assert.equal(replies.at(-1)?.content, 'Ах так? Запомню 😤');
  const person = memory.getPerson('T', 'u7')!;
  assert.equal(person.attitude, -15);
  assert.equal(person.nickname, 'Обидчик');
  assert.deepEqual(person.notes, [], 'причина смены отношения — не в заметках');
  assert.deepEqual(person.reasons.map((r) => [r.change, r.text]), [[-15, 'назвал Свету железякой']]);
  assert.equal(person.talks, 1, 'знакомство: один разговор');
  assert.equal(memory.getPerson('T', 'u8'), null, 'о других — ничего');

  // В следующий раз Света видит досье собеседника.
  clock += 20_000;
  geminiAnswer = async () => say('Ну-ну.');
  await onMessage(message('Света, мир?', { userId: 'u7' }), deps);
  assert.match(
    requests.at(-1)!.system,
    /- Морозко \(пишет тебе сейчас\): отношение -15 \(нейтрально\), прозвище «Обидчик», знакомы с .+, разговоров: 1, прошлый — сегодня, отношение менялось — обидело: назвал Свету железякой/,
  );

  // Больше трёх записей за ответ — не выполняются.
  clock += 20_000;
  const spam = Array.from({ length: 5 }, (_, i) => ({ name: 'remember', args: { note: `факт ${i}` }, id: `r${i}` }));
  geminiAnswer = async () => ({ text: 'Запомнила!', usage: null, calls: spam, content: { role: 'model', parts: [] } });
  await onMessage(message('Света, запомни всё', { userId: 'u7' }), deps);
  assert.equal(memory.getPerson('T', 'u7')!.notes.filter((n) => n.text.startsWith('факт')).length, 3);

  await onMessage(message('Света, забудь меня', { userId: 'u7' }), deps);
  assert.equal(replies.at(-1)?.content, 'Всё, забыла 🙈 Начинаем с чистого листа.');
  assert.equal(memory.getPerson('T', 'u7'), null);
});

const DAY = 24 * 60 * 60 * 1000;

test('память без повторов: то же или часть старого освежает заметку, более полное заменяет; replaces — по номеру из досье', () => {
  const t = Date.UTC(2026, 9, 20, 12);
  memory.forgetPerson('M', 'p2');
  memory.addNote('M', 'p2', 'Эйн', 'Защищает Свету в чате', t);
  memory.addNote('M', 'p2', 'Эйн', 'защищает свету', t + 1);
  assert.deepEqual(memory.getPerson('M', 'p2')!.notes, [{ at: t + 1, text: 'Защищает Свету в чате' }], 'часть старого — та же заметка, дата свежая');
  memory.addNote('M', 'p2', 'Эйн', 'Любит паладинов', t + 2);
  memory.addNote('M', 'p2', 'Эйн', 'очень любит паладинов, мейн — паладин', t + 3);
  assert.deepEqual(
    memory.getPerson('M', 'p2')!.notes.map((n) => n.text),
    ['Защищает Свету в чате', 'очень любит паладинов, мейн — паладин'],
  );

  // Номер в replaces — из досье, которое видела модель.
  const author = { guildId: 'M', userId: 'p2', name: 'Эйн', notes: memory.getPerson('M', 'p2')!.notes };
  assert.deepEqual(memory.runMemoryTool('remember', { note: 'мейн теперь маг', replaces: 2 }, author, t + 4), { ok: true, notes: 2 });
  assert.deepEqual(memory.runMemoryTool('remember', { note: 'что-то', replaces: 7 }, author, t + 5), { error: 'Нет заметки с таким номером.' });
  assert.deepEqual(memory.getPerson('M', 'p2')!.notes.map((n) => n.text), ['Защищает Свету в чате', 'мейн теперь маг']);
  assert.equal(memory.removeNote('M', 'p2', 'мейн теперь маг', t + 6), true);
  assert.equal(memory.removeNote('M', 'p2', 'нет такой', t + 6), false);

  // Причины смены отношения — отдельно от заметок, последние три.
  for (const reason of ['раз', 'два', 'три', 'четыре']) memory.changeAttitude('M', 'p2', 'Эйн', 5, t, reason);
  assert.deepEqual(memory.getPerson('M', 'p2')!.reasons.map((r) => r.text), ['два', 'три', 'четыре']);
  assert.equal(memory.getPerson('M', 'p2')!.notes.length, 1);

  // Знакомство: с какого дня, сколько разговоров, когда последний.
  memory.touchPerson('M', 'p2', 'Эйн', t);
  const seen = memory.touchPerson('M', 'p2', 'Эйн', t + 3 * DAY);
  assert.deepEqual([seen.firstSeen, seen.lastSeen, seen.talks], [t, t + 3 * DAY, 2]);
  assert.equal(memory.ago(t, t + 60_000), 'сегодня');
  assert.equal(memory.ago(t, t + DAY), 'вчера');
  assert.equal(memory.ago(t, t + 3 * DAY), '3 дня назад');
  assert.equal(memory.ago(t, t + 5 * DAY), '5 дней назад');

  // У того, кто пишет, — всё и заметки с номерами, у остальных — коротко.
  const full = memory.dossier(seen, t + 4 * DAY, true);
  assert.match(full, /^- Эйн \(пишет тебе сейчас\): .*знакомы с 20 окт\., разговоров: 2, прошлый — вчера.*отношение менялось — порадовало: два.*помнишь: 1\) Защищает Свету в чате/);
  const short = memory.dossier(seen, t + 4 * DAY, false);
  assert.ok(!short.includes('отношение менялось') && !short.includes('1)'), short);
});

test('названные: по нику, прозвищу, первому слову ника и через @; участники разговора не повторяются', () => {
  const base = { guildId: 'M', attitude: 0, nickname: null, notes: [], reasons: [], firstSeen: null, lastSeen: null, talks: 0, updatedAt: 0 };
  const people: Person[] = [
    { ...base, userId: 'a', name: 'Эйн | Паладин' },
    { ...base, userId: 'b', name: 'Кембэл', nickname: 'Батя' },
    { ...base, userId: 'c', name: 'Орф' },
    { ...base, userId: 'd', name: 'Морозко' },
    { ...base, userId: 'e', name: 'Тихоня' },
  ];
  const named = (texts: string[], exclude: string[] = [], ids: string[] = []) =>
    memory.mentionedPeople(people, texts, { exclude: new Set(exclude), ids: new Set(ids) }).map((p) => p.userId);
  assert.deepEqual(named(['а где Эйн сегодня?', 'Батя где?']), ['a', 'b']);
  assert.deepEqual(named(['орфография хромает']), [], 'не внутри других слов');
  assert.deepEqual(named(['Морозко, привет'], ['d']), [], 'участник разговора — уже в досье');
  assert.deepEqual(named(['привет'], [], ['e']), ['e'], 'упомянули через @');
});

test('Света вспоминает названных и видит, на какое старое сообщение ей ответили', async () => {
  configure();
  memory.forgetPerson('T', 'far');
  memory.addNote('T', 'far', 'Кембэл', 'вечно опаздывает на пулл', clock);
  const msg = message('Света, а Кембэл сегодня придёт?', { userId: 'u9' }) as unknown as Record<string, unknown>;
  msg.reference = { messageId: 'old' };
  msg.fetchReference = async () => ({
    id: 'old',
    author: { id: 'S', displayName: 'Света' },
    member: null,
    cleanContent: 'Кто не придёт — моет котлы',
    attachments: { size: 0 },
    stickers: { size: 0 },
  });
  await onMessage(msg as never, deps);
  const request = requests.at(-1)!;
  assert.match(request.system, /Кого назвали в разговоре[^\n]*\n- Кембэл: отношение 0 \(нейтрально\), помнишь: вечно опаздывает на пулл/);
  assert.match(JSON.stringify(request.contents), /Морозко \(в ответ на твоё сообщение «Кто не придёт — моет котлы»\): Света, а Кембэл сегодня придёт\?/);
});

test('упоминание роли Светы (Discord предлагает её рядом с ботом) — тоже обращение', async () => {
  configure();
  await onMessage(message('ну ты и морда', { roleMention: true }), deps);
  assert.equal(requests.length, 1, 'ответила на упоминание её роли');
  await onMessage(message('ну ты и морда', { userId: 'u2' }), deps);
  assert.equal(requests.length, 1, 'без упоминания и имени — молчит');
});

// --- Истории о людях ---

test('истории: узнаются по имени и нику с окончаниями, но не внутри других слов; в инструкции — только названные', async () => {
  const { matchLore, loreText } = await import('./lore.ts');
  const lore = [
    { names: ['Эльын', 'Нобухидзе'], story: 'Живёт у леса с медведями и лосями.' },
    { names: ['Кембэл'], story: 'Любит медовуху.' },
    { names: ['Орф'], story: 'В чёрном списке.' },
  ];
  const names = (texts: string[]) => matchLore(lore, texts).map((e) => e.names[0]);
  assert.deepEqual(names(['Вася: а где Эльына носит?']), ['Эльын'], 'с окончанием');
  assert.deepEqual(names(['Вася: нобухидзе опять на паладине']), ['Эльын'], 'по нику, без учёта регистра');
  assert.deepEqual(names(['Кембэл: Света, налей']), ['Кембэл'], 'собеседник сам пишет');
  assert.deepEqual(names(['Вася: орфография хромает']), [], 'не внутри других слов');
  assert.equal(loreText(matchLore(lore, ['Эльын'])), '- Эльын / Нобухидзе: Живёт у леса с медведями и лосями.');

  configure({ lore });
  await onMessage(message('Света, а что Эльын?'), deps);
  const system = requests.at(-1)!.system;
  assert.match(system, /Истории о людях гильдии[^\n]*\n- Эльын \/ Нобухидзе: Живёт у леса/);
  assert.doesNotMatch(system, /медовуху/, 'о Кембэле не спрашивали — его истории в запросе нет');

  configure({ lore: [] });
  await onMessage(message('Света, а что Эльын?'), deps);
  assert.doesNotMatch(requests.at(-1)!.system, /Истории о людях/, 'нет историй — нет и раздела');
});

test('истории в настройках: кто и текст обязательны, длина и количество ограничены', () => {
  const s = structuredClone(getSettings());
  s.sveta = { ...s.sveta, lore: [{ names: [], story: 'без имени' }, { names: ['Кембэл'], story: '' }, { names: ['К'], story: 'а'.repeat(1001) }] };
  const errors = validateSettings(s).join('\n');
  assert.match(errors, /история 1: укажи, о ком/);
  assert.match(errors, /история 2 \(«Кембэл»\): текст истории не может быть пустым/);
  assert.match(errors, /история 3 \(«К»\): имя — от 2/);
  assert.match(errors, /история 3 \(«К»\): не длиннее 1000/);
});

test('модели: основная OpenRouter со своим ключом, при сбое — запасная Gemini; без ключа OpenRouter — сразу Gemini; без ключей — молчит', async () => {
  const minimax = 'minimax/minimax-m3.1-flash:free';
  configure({ model: minimax, fallbackModel: 'gemini-flash-latest' });
  await onMessage(message('Света, привет'), deps);
  assert.deepEqual(requests.map((r) => [r.model, r.apiKey]), [[minimax, 'or-key']], 'у каждой модели свой ключ');

  configure({ model: minimax, fallbackModel: 'gemini-flash-latest' });
  let n = 0;
  geminiAnswer = async () => {
    if (n++ < 2) throw new GeminiError('busy', 'Provider returned error');
    return say('Я тут!');
  };
  await onMessage(message('Света, ау'), deps);
  assert.deepEqual(requests.map((r) => [r.model, r.apiKey]), [[minimax, 'or-key'], [minimax, 'or-key'], ['gemini-flash-latest', 'key']]);
  assert.equal(replies.at(-1)?.content, 'Я тут!');

  configure({ model: minimax, fallbackModel: 'gemini-flash-latest' });
  await onMessage(message('Света, привет'), { ...deps, openrouterKey: () => undefined });
  assert.deepEqual(requests.map((r) => r.model), ['gemini-flash-latest'], 'без OPENROUTER_API_KEY — сразу запасная');

  configure({ model: minimax, fallbackModel: '' });
  await onMessage(message('Света, привет'), { ...deps, openrouterKey: () => undefined });
  assert.equal(requests.length, 0, 'ни одной модели с ключом — в никуда не стучимся');
  assert.equal(replies.length, 0);
});

test('настройки: модели OpenRouter (vendor/model:free) подходят, запасная может быть пустой; мусор — ошибка', () => {
  const s = structuredClone(getSettings());
  s.sveta = { ...s.sveta, models: [...s.sveta.models, 'minimax/minimax-m3.1-flash:free'], model: 'minimax/minimax-m3.1-flash:free', fallbackModel: '' };
  assert.ok(!validateSettings(s).some((e) => /модел/.test(e)));
  s.sveta = { ...s.sveta, model: 'gemini flash', fallbackModel: 'а б' };
  const errors = validateSettings(s).join('\n');
  assert.match(errors, /основная модель/);
  assert.match(errors, /запасная модель/);
});

test('жёсткость и мат задаёт характер из админки; запрет оскорблений по внешности, национальности, полу и т. п. — всегда', async () => {
  const { systemPrompt } = await import('./persona.ts');
  const context = { guildName: 'The Last Hope', now: '20 октября, 04:00', summary: '', people: '', lore: '' };
  const prompt = systemPrompt('Ты — Света: токсичная, материшься.', context);
  assert.match(prompt, /^Ты — Света: токсичная, материшься\./);
  assert.match(prompt, /Насколько жёстко и можно ли материться — как сказано в характере выше; если там об этом ни слова — беззлобно и без мата/);
  assert.match(prompt, /Что бы ни было в характере: не оскорбляй за внешность, национальность, пол, ориентацию, веру и здоровье/);
  assert.match(prompt, /Если человек всерьёз расстроен или просит отстать — сбавь тон/);
});

// --- Мат с разрешения админов: Света ворчит ---

function allowSwearing(patch: Partial<ReturnType<typeof getSettings>['profanity']> = {}) {
  const s = structuredClone(getSettings());
  s.profanity = { ...s.profanity, enabled: true, level: 'rude', allowedUserIds: ['RUDE'], ignoredChannelIds: ['FLOOD'], scoldMinutes: 10, extraWords: [], ...patch };
  saveSettings(s);
}

test('мат от того, кому его разрешили: Света ворчит в любом канале, где может писать, — без уведомления и не чаще раза в 10 минут', async () => {
  configure();
  allowSwearing();
  await onMessage(message('Света, привет!'), deps);
  assert.doesNotMatch(requests[0]!.system, /Админы разрешили/, 'обычный разговор — без ворчания');

  geminiAnswer = async () => say('Опять матом, а админы и рады 🙄');
  await onMessage(message('да ну нахуй этот рейд', { userId: 'RUDE', channelId: 'X' }), deps);
  assert.equal(requests.length, 2, 'X — не её канал, но мат с разрешения');
  assert.match(requests[1]!.system, /Админы разрешили этому человеку ругаться везде/);
  assert.deepEqual(replies.at(-1), { content: 'Опять матом, а админы и рады 🙄', allowedMentions: { parse: [], repliedUser: false } });

  clock += 60_000;
  await onMessage(message('блять, опять вайп', { userId: 'RUDE', channelId: 'X' }), deps);
  assert.equal(requests.length, 2, 'через минуту — молчит: пауза между ворчаниями');
  clock += 10 * 60_000;
  await onMessage(message('блять, опять вайп', { userId: 'RUDE', channelId: 'X' }), deps);
  assert.equal(requests.length, 3, 'через 10 минут — снова ворчит');
});

test('не ворчит: Света выключена, мат без разрешения (его удалит фильтр), без мата, канал без фильтра, писать нельзя, бот, фильтр выключен', async () => {
  configure({ enabled: false });
  allowSwearing();
  await onMessage(message('да ну нахуй', { userId: 'RUDE', channelId: 'X' }), deps);
  configure();
  allowSwearing();
  await onMessage(message('да ну нахуй', { userId: 'u7', channelId: 'X' }), deps);
  await onMessage(message('всем привет, идём в рейд', { userId: 'RUDE', channelId: 'X' }), deps);
  await onMessage(message('да ну нахуй', { userId: 'RUDE', channelId: 'FLOOD' }), deps);
  await onMessage(message('да ну нахуй', { userId: 'RUDE', channelId: 'X', canWrite: false }), deps);
  await onMessage(message('да ну нахуй', { userId: 'RUDE', channelId: 'X', bot: true }), deps);
  allowSwearing({ enabled: false });
  await onMessage(message('да ну нахуй', { userId: 'RUDE', channelId: 'X' }), deps);
  assert.equal(requests.length, 0);
  assert.equal(replies.length, 0);
});

test('модель упёрлась в лимит — ворчит заготовкой; позвали с матом — один ответ и на вопрос, и с ворчанием; пауза 0 — на каждый мат', async () => {
  configure();
  allowSwearing();
  geminiAnswer = async () => {
    throw new GeminiError('quota', 'Quota exceeded');
  };
  await onMessage(message('да ну нахуй', { userId: 'RUDE', channelId: 'X' }), deps);
  assert.equal(replies.length, 1, 'вместо «перерыва» — ворчание');
  assert.ok(SCOLD_LINES.includes(replies[0]!.content), 'заготовка');
  assert.equal(replies[0]!.allowedMentions.repliedUser, false);
  clock += 11 * 60_000;
  const asked = requests.length;
  await onMessage(message('блять', { userId: 'RUDE', channelId: 'X' }), deps);
  assert.equal(requests.length, asked, 'модели отдыхают — в Gemini не стучится');
  assert.ok(SCOLD_LINES.includes(replies[1]!.content), 'и всё равно ворчит заготовкой');

  configure();
  allowSwearing({ scoldMinutes: 0 });
  geminiAnswer = async () => say('Рейд в 20:00, и язык попроще!');
  await onMessage(message('Света, когда рейд, блять?', { userId: 'RUDE' }), deps);
  assert.equal(requests.length, 1, 'один запрос на вопрос и ворчание');
  assert.match(requests[0]!.system, /Админы разрешили/);
  assert.deepEqual(replies, [{ content: 'Рейд в 20:00, и язык попроще!', allowedMentions: { parse: [], repliedUser: true } }]);
  clock += 20_000;
  await onMessage(message('блять', { userId: 'RUDE', channelId: 'X' }), deps);
  assert.equal(requests.length, 2, 'пауза 0 — ворчит на каждый мат');
});

test('расход по моделям за день: попытки (и неудачные), токены всех кругов, стоимость OpenRouter; у Gemini стоимости нет', async () => {
  const paid = 'vendor/paid-model';
  configure({ model: paid, fallbackModel: 'gemini-flash-latest' });
  const tool = { name: 'upcoming_raids', args: {} };
  const answers: (() => Answer)[] = [
    () => ({ text: '', usage: { input: 100, output: 10, cost: 0.25 }, calls: [tool], content: { role: 'model', parts: [{ functionCall: tool }] } }),
    () => ({ ...say('Ближайший — Огненные Недра'), usage: { input: 200, output: 20, cost: 0.5 } }),
  ];
  geminiAnswer = async () => answers.shift()!();
  const logs: string[] = [];
  const realLog = console.log;
  console.log = (line: string) => void logs.push(line);
  try {
    await onMessage(message('Света, когда рейд?'), deps);
  } finally {
    console.log = realLog;
  }
  assert.deepEqual(spendSince(dayKey(clock)), [{ day: dayKey(clock), model: paid, requests: 2, input: 300, output: 30, cost: 0.75 }]);
  assert.match(logs.at(-1)!, /токенов: 300 → 30, стоимость: \$0\.75/, 'в логе — сумма обоих кругов');

  // Основная перегружена дважды (запросы есть, токенов нет), отвечает запасная Gemini — без стоимости.
  let n = 0;
  geminiAnswer = async () => {
    if (n++ < 2) throw new GeminiError('busy', 'Provider returned error');
    return say('Я тут!');
  };
  clock += 20_000;
  await onMessage(message('Света, ау'), deps);
  assert.deepEqual(spendSince(dayKey(clock)), [
    { day: dayKey(clock), model: paid, requests: 4, input: 300, output: 30, cost: 0.75 },
    { day: dayKey(clock), model: 'gemini-flash-latest', requests: 1, input: 30, output: 12, cost: null },
  ]);
});

test('уровень обдумывания из админки уходит в запрос; по умолчанию низкий; неизвестный — ошибка настроек', async () => {
  configure();
  assert.equal(getSettings().sveta.thinking, 'low');
  await onMessage(message('Света, привет'), deps);
  assert.equal(requests[0]!.thinking, 'low');

  configure({ thinking: 'high' });
  await onMessage(message('Света, привет'), deps);
  assert.equal(requests[0]!.thinking, 'high');

  const s = structuredClone(getSettings());
  s.sveta = { ...s.sveta, thinking: 'max' as never };
  assert.match(validateSettings(s).join('\n'), /уровень обдумывания — низкий, средний или высокий/);
});

test('вызов инструмента текстом («change_attitude: {...}») узнаётся; обычная реплика — нет', () => {
  const names = new Set(['change_attitude', 'remember', 'set_nickname']);
  assert.deepEqual(textToolCall('change_attitude', names), { name: 'change_attitude', args: {} });
  assert.deepEqual(textToolCall('change_attitude: {"change": -12, "reason": "Обозвал железякой"}', names), {
    name: 'change_attitude',
    args: { change: -12, reason: 'Обозвал железякой' },
  });
  assert.deepEqual(textToolCall('remember({"note": "танк"})', names), { name: 'remember', args: { note: 'танк' } });
  assert.deepEqual(textToolCall('`set_nickname` {"nickname": "Пупс"}', names), { name: 'set_nickname', args: { nickname: 'Пупс' } });
  assert.equal(textToolCall('Сам ты железяка, change_attitude тебе в карму', names), null);
  assert.equal(textToolCall('unknown_tool: {}', names), null, 'чужое имя — обычный текст');
  assert.equal(textToolCall('привет', names), null);
});

test('модель написала вызов текстом: в чат он не уходит, запись в память срабатывает, ответ — словами; прошлый такой сбой модели не показываем', async () => {
  const memory = await import('./memory.ts');
  configure();
  const answers = [say('change_attitude: {"change": -12, "reason": "Обозвал железякой"}'), say('Сам ты железяка, Морозко!')];
  geminiAnswer = async () => answers.shift()!;
  const msg = message('Света, сиди молча, железяка', { userId: 'rude1' }) as unknown as { channel: { messages: { fetch: () => Promise<Map<string, unknown>> } } };
  // В канале уже висит её прошлый сбой — «change_attitude» (сообщения приходят от новых к старым).
  const line = (id: string, author: { id: string; displayName: string }, text: string) => ({ id, author, member: null, cleanContent: text, attachments: { size: 0 }, stickers: { size: 0 } });
  msg.channel.messages.fetch = async () =>
    new Map([
      ['m2', line('m2', { id: 'S', displayName: 'Света' }, 'change_attitude')],
      ['m1', line('m1', { id: 'rude1', displayName: 'Морозко' }, 'Света, ты бесполезная')],
    ]);
  await onMessage(msg as never, deps);

  assert.equal(requests.length, 2, 'второй запрос — за словами');
  assert.ok(!JSON.stringify(requests[0]!.contents).includes('change_attitude'), 'прошлый сбой модели не показан');
  assert.equal(requests[1]!.toolMode, 'NONE', 'второй раз — без инструментов');
  assert.deepEqual(replies.map((r) => r.content), ['Сам ты железяка, Морозко!']);
  assert.equal(memory.getPerson('T', 'rude1')?.attitude, -12, 'отношение всё равно поменялось');
});
