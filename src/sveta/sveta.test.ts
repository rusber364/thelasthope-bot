import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.BOT_DB_PATH = ':memory:';
const { callsByName, triggerOf } = await import('./triggers.ts');
const { buildContents, cleanReply, lineText } = await import('./context.ts');
const { GeminiError, generate, parseResponse, requestBody } = await import('./gemini.ts');
const { onMessage, resetSveta, svetaInviteUrl } = await import('./index.ts');
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
  const old = requestBody({ model: 'gemini-2.5-flash', system: '', contents: [] });
  assert.equal('thinkingConfig' in old.generationConfig, false);
});

test('ответ Gemini: текст без «мыслей»; 429 — лимит, неверный ключ, нет модели, фильтр — понятные ошибки', () => {
  const ok = parseResponse(200, {
    candidates: [{ content: { parts: [{ text: 'думаю…', thought: true }, { text: 'Привет, ' }, { text: 'рейдер!' }] }, finishReason: 'STOP' }],
    usageMetadata: { totalTokenCount: 77 },
  });
  assert.deepEqual(ok, { text: 'Привет, рейдер!', tokens: 77 });

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
  assert.equal(kind(500, {}), 'unavailable');
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
const requests: { model: string; system: string; contents: { role: string; parts: { text: string }[] }[] }[] = [];
let geminiAnswer: () => Promise<{ text: string; tokens: number | null }> = async () => ({ text: 'Света: Привет, Морозко! 👋', tokens: 42 });
let clock = Date.UTC(2026, 9, 19, 18, 0);
let roll = 0.99;
const deps = {
  generate: async (request: (typeof requests)[number]) => {
    requests.push(request);
    return geminiAnswer();
  },
  now: () => clock,
  random: () => roll,
  apiKey: () => 'key' as string | undefined,
};

const earlier = new Map([['m0', { id: 'm0', author: { id: 'S', displayName: 'Света' }, member: null, cleanContent: 'Кто сегодня танкует?', attachments: { size: 0 }, stickers: { size: 0 } }]]);
function message(content: string, { userId = 'u1', channelId = 'C', bot = false, mention = false } = {}) {
  const msg = {
    id: `m${Math.random()}`,
    content,
    cleanContent: content,
    channelId,
    client: { user: { id: 'S' } },
    author: { id: userId, bot, displayName: 'Морозко' },
    member: { displayName: 'Морозко' },
    guild: { name: 'The Last Hope' },
    attachments: { size: 0 },
    stickers: { size: 0 },
    mentions: { users: new Map(mention ? [['S', {}]] : []), repliedUser: null },
    channel: { name: 'таверна', sendTyping: async () => {}, messages: { fetch: async () => earlier } },
    inGuild: () => true,
    reply: async (payload: (typeof replies)[number]) => void replies.push(payload),
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
  geminiAnswer = async () => ({ text: 'Света: Привет, Морозко! 👋', tokens: 42 });
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
  clock += 30 * 60 * 1000;
  await onMessage(message('Света, ау', { userId: 'u2' }), deps);
  assert.equal(requests.length, 1, 'полчаса спустя — всё ещё на перерыве, в Gemini не стучимся');

  configure();
  geminiAnswer = async () => {
    throw new GeminiError('blocked', 'SAFETY');
  };
  await onMessage(message('Света, скажи гадость'), deps);
  assert.equal(replies.at(-1)?.content, 'Не-не, такое я обсуждать не буду 😅');

  configure({ randomPercent: 20 });
  roll = 0.01;
  await onMessage(message('кто-нибудь знает, когда патч выйдет?'), deps);
  roll = 0.99;
  assert.equal(replies.at(-1)?.allowedMentions.repliedUser, false, 'встряла сама — автору без уведомления');
});
