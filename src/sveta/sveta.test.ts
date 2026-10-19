import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GeminiReply, GeminiRequest } from './gemini.ts';

process.env.BOT_DB_PATH = ':memory:';
const { callsByName, triggerOf } = await import('./triggers.ts');
const { buildContents, cleanReply, lineText } = await import('./context.ts');
const { GeminiError, generate, parseResponse, requestBody } = await import('./gemini.ts');
const { onMessage, resetSveta, svetaInviteUrl } = await import('./index.ts');
const { TOOLS, guildSummary, runTool } = await import('./tools.ts');
const { newsText } = await import('./news.ts');
const { createRaid, upsertSignup, setTentative } = await import('../raids/store.ts');
const { requestsOn, dayKey } = await import('./limits.ts');
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
  assert.equal('tools' in old, false, 'без инструментов — без tools');
  const withTools = requestBody({ model: 'gemini-flash-latest', system: '', contents: [], tools: TOOLS, toolMode: 'NONE' });
  assert.deepEqual(withTools.tools?.[0]?.functionDeclarations.map((t) => t.name), ['upcoming_raids', 'raid_roster', 'raid_schedule']);
  assert.deepEqual(withTools.toolConfig, { functionCallingConfig: { mode: 'NONE' } });
});

test('ответ Gemini: текст без «мыслей»; 429 — лимит, неверный ключ, нет модели, фильтр — понятные ошибки', () => {
  const ok = parseResponse(200, {
    candidates: [{ content: { parts: [{ text: 'думаю…', thought: true }, { text: 'Привет, ' }, { text: 'рейдер!' }] }, finishReason: 'STOP' }],
    usageMetadata: { totalTokenCount: 77 },
  });
  assert.equal(ok.text, 'Привет, рейдер!');
  assert.equal(ok.tokens, 77);
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
const requests: GeminiRequest[] = [];
type Answer = GeminiReply;
const say = (text: string): Answer => ({ text, tokens: 42, calls: [], content: { role: 'model', parts: [{ text }] } });
let geminiAnswer: () => Promise<Answer> = async () => say('Света: Привет, Морозко! 👋');
let clock = Date.UTC(2026, 9, 19, 18, 0);
let roll = 0.99;
const deps = {
  generate: async (request: GeminiRequest) => {
    requests.push(request);
    return geminiAnswer();
  },
  now: () => clock,
  random: () => roll,
  apiKey: () => 'key' as string | undefined,
};

const earlier = new Map([['m0', { id: 'm0', author: { id: 'S', displayName: 'Света' }, member: null, cleanContent: 'Кто сегодня танкует?', attachments: { size: 0 }, stickers: { size: 0 } }]]);
function message(content: string, { userId = 'u1', channelId = 'C', bot = false, mention = false, roleMention = false, guildId = 'T' } = {}) {
  const msg = {
    id: `m${Math.random()}`,
    content,
    cleanContent: content,
    channelId,
    guildId,
    client: { user: { id: 'S' } },
    author: { id: userId, bot, displayName: 'Морозко' },
    member: { displayName: 'Морозко' },
    guild: { name: 'The Last Hope' },
    attachments: { size: 0 },
    stickers: { size: 0 },
    mentions: {
      users: new Map(mention ? [['S', {}]] : []),
      // Роль бота «Sveta» (managed): tags.botId — это Света.
      roles: { some: (fn: (role: { tags?: { botId?: string } }) => boolean) => (roleMention ? [{ tags: { botId: 'S' } }] : []).some(fn) },
      repliedUser: null,
    },
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
  clock += 30 * 60 * 1000;
  await onMessage(message('Света, ау', { userId: 'u2' }), deps);
  assert.equal(requests.length, 1, 'полчаса спустя — всё ещё на перерыве, в Gemini не стучимся');

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
    { text: '', tokens: 10, calls: [{ name: 'raid_roster', args: { raid_id: raid.id }, id: 'call-1' }], content: { role: 'model', parts: [{ functionCall: { name: 'raid_roster', args: { raid_id: raid.id }, id: 'call-1' }, thoughtSignature: 'sig' }] } },
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
  const loop: Answer = { text: '', tokens: 1, calls: [{ name: 'upcoming_raids', args: {} }], content: { role: 'model', parts: [{ functionCall: { name: 'upcoming_raids', args: {} } }] } };
  let n = 0;
  geminiAnswer = async () => (++n < 3 ? loop : say('Вот что есть 📜'));
  await onMessage(message('Света, что по сборам?'), deps);
  assert.deepEqual(requests.map((r) => r.toolMode), ['AUTO', 'AUTO', 'NONE']);
  assert.equal(replies.at(-1)?.content, 'Вот что есть 📜');
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

test('память: шаг отношения не больше ±20 и предел ±100; заметки без упоминаний, не длиннее 200, хранятся последние 10', () => {
  const t = 1_000;
  assert.equal(memory.changeAttitude('M', 'p1', 'Вася', 50, t).attitude, 20, 'за раз — не больше 20');
  for (let i = 0; i < 10; i++) memory.changeAttitude('M', 'p1', 'Вася', 20, t);
  assert.equal(memory.getPerson('M', 'p1')!.attitude, 100);
  assert.equal(memory.changeAttitude('M', 'p1', 'Вася', -500, t).attitude, 80);

  memory.addNote('M', 'p1', 'Вася', 'зовёт <@123> и @everyone   в рейд', t);
  assert.equal(memory.getPerson('M', 'p1')!.notes[0]!.text, 'зовёт и everyone в рейд');
  for (let i = 0; i < 12; i++) memory.addNote('M', 'p1', 'Вася', `заметка ${i}`, t + i);
  const notes = memory.getPerson('M', 'p1')!.notes;
  assert.equal(notes.length, 10);
  assert.equal(notes.at(-1)!.text, 'заметка 11');
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
  const report = memory.memoryReport({ guildId: 'M', userId: 'p', name: 'Вася', attitude: -35, nickname: 'Беглый танк', notes: [{ at: 0, text: 'убежал с пулла' }], updatedAt: 0 });
  assert.match(report, /Отношение: -35 — недолюбливаю/);
  assert.match(report, /Прозвище: «Беглый танк»/);
  assert.match(report, /• .+: убежал с пулла/);
  assert.match(memory.dossiers([]), /пока ничего не помнишь/);

  const bad = memory.personInput({ attitude: 150, nickname: 'x'.repeat(40), notes: Array.from({ length: 11 }, () => 'n') });
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
    tokens: 5,
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
  assert.match(person.notes[0]!.text, /железякой/, 'причина заметной смены отношения — в заметках');
  assert.equal(memory.getPerson('T', 'u8'), null, 'о других — ничего');

  // В следующий раз Света видит досье собеседника.
  clock += 20_000;
  geminiAnswer = async () => say('Ну-ну.');
  await onMessage(message('Света, мир?', { userId: 'u7' }), deps);
  assert.match(requests.at(-1)!.system, /- Морозко: отношение -15 \(нейтрально\), прозвище «Обидчик», помнишь: обидело: назвал Свету железякой/);

  // Больше трёх записей за ответ — не выполняются.
  clock += 20_000;
  const spam = Array.from({ length: 5 }, (_, i) => ({ name: 'remember', args: { note: `факт ${i}` }, id: `r${i}` }));
  geminiAnswer = async () => ({ text: 'Запомнила!', tokens: 1, calls: spam, content: { role: 'model', parts: [] } });
  await onMessage(message('Света, запомни всё', { userId: 'u7' }), deps);
  assert.equal(memory.getPerson('T', 'u7')!.notes.filter((n) => n.text.startsWith('факт')).length, 3);

  await onMessage(message('Света, забудь меня', { userId: 'u7' }), deps);
  assert.equal(replies.at(-1)?.content, 'Всё, забыла 🙈 Начинаем с чистого листа.');
  assert.equal(memory.getPerson('T', 'u7'), null);
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
