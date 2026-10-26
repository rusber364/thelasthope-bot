import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GeminiError, type GeminiContent } from './gemini.ts';
import { generateOpenRouter, isOpenRouterModel, openRouterBody, parseOpenRouter, toMessages } from './openrouter.ts';

// Инструменты Светы читают базу — в тестах она в памяти (до их импорта ниже).
process.env.BOT_DB_PATH = ':memory:';

const MODEL = 'minimax/minimax-m3.1-flash:free';

test('модель с «/» — OpenRouter, без — Gemini', () => {
  assert.equal(isOpenRouterModel(MODEL), true);
  assert.equal(isOpenRouterModel('gemini-flash-latest'), false);
});

test('переписка Gemini → сообщения OpenAI: система, люди, Света, вызов инструмента и его результат с тем же id', () => {
  const contents: GeminiContent[] = [
    { role: 'user', parts: [{ text: 'Морозко: Света, кто танкует?' }] },
    { role: 'model', parts: [{ text: 'Сейчас гляну' }, { functionCall: { name: 'raid_roster', args: { raid_id: 3 }, id: 'call_1' } }] },
    { role: 'user', parts: [{ functionResponse: { name: 'raid_roster', id: 'call_1', response: { result: { main: ['Проттоварыч'] } } } }] },
    { role: 'model', parts: [{ text: 'Танкует Проттоварыч', thought: false }, { text: 'мысли', thought: true }] },
  ];
  assert.deepEqual(toMessages('Ты — Света', contents), [
    { role: 'system', content: 'Ты — Света' },
    { role: 'user', content: 'Морозко: Света, кто танкует?' },
    {
      role: 'assistant',
      content: 'Сейчас гляну',
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'raid_roster', arguments: '{"raid_id":3}' } }],
    },
    { role: 'tool', tool_call_id: 'call_1', content: '{"result":{"main":["Проттоварыч"]}}' },
    { role: 'assistant', content: 'Танкует Проттоварыч' },
  ]);
  const raw = { role: 'assistant', content: null, tool_calls: [], reasoning_details: [{ type: 'reasoning.encrypted', data: 'x' }] };
  assert.deepEqual(toMessages('s', [{ role: 'model', parts: [], raw }]).at(-1), raw, 'ответ модели с вызовом возвращается как есть');
});

test('тело запроса: короткие размышления, инструменты в формате OpenAI; на последнем круге — tool_choice none', () => {
  const tools = [{ name: 'upcoming_raids', description: 'Ближайшие сборы' }];
  const body = openRouterBody({ model: MODEL, system: 's', contents: [], tools, toolMode: 'NONE' });
  assert.equal(body.model, MODEL);
  assert.deepEqual(body.reasoning, { effort: 'low' });
  assert.deepEqual(body.tools, [{ type: 'function', function: { ...tools[0], parameters: { type: 'object', properties: {} } } }], 'без параметров — пустой объект: MiniMax иначе отказывает');
  assert.equal(body.tool_choice, 'none');
  assert.equal(openRouterBody({ model: MODEL, system: 's', contents: [], tools, toolMode: 'AUTO' }).tool_choice, 'auto');
  assert.ok(!('tools' in openRouterBody({ model: MODEL, system: 's', contents: [] })), 'без инструментов — без tools');
});

test('ответ: текст без <think>, вызовы с id и аргументами; сообщение с вызовом сохраняется для следующего круга', () => {
  const reply = parseOpenRouter(200, {
    choices: [
      {
        message: {
          content: '<think>подумаю</think>Гляну состав',
          tool_calls: [{ id: 'call_9', function: { name: 'raid_roster', arguments: '{"raid_id":3}' } }],
          reasoning_details: [{ type: 'reasoning.text', text: '…' }],
        },
      },
    ],
    usage: { prompt_tokens: 300, completion_tokens: 21, cost: 0 },
  });
  assert.equal(reply.text, 'Гляну состав');
  assert.deepEqual(reply.usage, { input: 300, output: 21, cost: 0 }, 'бесплатная модель — стоимость 0');
  assert.deepEqual(reply.calls, [{ name: 'raid_roster', args: { raid_id: 3 }, id: 'call_9' }]);
  assert.deepEqual(reply.content.raw, {
    role: 'assistant',
    content: '<think>подумаю</think>Гляну состав',
    tool_calls: [{ id: 'call_9', function: { name: 'raid_roster', arguments: '{"raid_id":3}' } }],
    reasoning_details: [{ type: 'reasoning.text', text: '…' }],
  });
  const plain = parseOpenRouter(200, { choices: [{ message: { content: 'Привет!' } }] });
  assert.deepEqual([plain.text, plain.calls, plain.content.raw], ['Привет!', [], undefined]);
  assert.deepEqual(parseOpenRouter(200, { choices: [{ message: { tool_calls: [{ id: 'c', function: { name: 'x', arguments: 'не json' } }] } }] }).calls, [
    { name: 'x', args: {}, id: 'c' },
  ]);
});

test('ошибки OpenRouter — те же виды, что у Gemini: лимит в минуту и в день, нет денег, ключ, модель, перегрузка, фильтр', () => {
  const kind = (status: number, json: object) => {
    try {
      parseOpenRouter(status, json);
      return 'ok';
    } catch (error) {
      return error instanceof GeminiError ? error.kind : 'other';
    }
  };
  assert.equal(kind(429, { error: { code: 429, message: 'Rate limit exceeded: free-models-per-min.' } }), 'rate');
  assert.equal(kind(429, { error: { code: 429, message: 'Rate limit exceeded: free-models-per-day.' } }), 'quota');
  assert.equal(kind(402, { error: { code: 402, message: 'Insufficient credits' } }), 'quota');
  assert.equal(kind(403, { error: { code: 403, message: 'Key limit exceeded' } }), 'quota', 'дневной лимит ключа — отдых и запасная модель, а не «неверный ключ»');
  assert.equal(kind(401, { error: { code: 401, message: 'User not found.' } }), 'auth', 'ключ управления вместо обычного');
  assert.equal(kind(401, { error: { code: 401, message: 'No auth credentials found' } }), 'auth');
  assert.equal(kind(404, { error: { code: 404, message: 'No endpoints found' } }), 'model');
  assert.equal(kind(400, { error: { code: 400, message: 'minimax/nope is not a valid model ID' } }), 'model');
  assert.equal(kind(503, { error: { code: 503, message: 'Provider returned error' } }), 'busy');
  assert.equal(kind(200, { error: { code: 502, message: 'Upstream error' } }), 'busy', 'ошибка в теле при 200');
  assert.equal(kind(200, { choices: [{ message: { content: '' }, finish_reason: 'content_filter' }] }), 'blocked');
});

test('запрос: ключ в заголовке Authorization, модель — в теле', async () => {
  const realFetch = globalThis.fetch;
  let seen: { url: string; auth: string | null; model: string } | null = null;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen = { url, auth: new Headers(init.headers).get('authorization'), model: JSON.parse(String(init.body)).model };
    return Response.json({ choices: [{ message: { content: 'ок' } }] });
  }) as typeof fetch;
  try {
    const reply = await generateOpenRouter({ apiKey: 'or-secret', model: MODEL, system: 's', contents: [] });
    assert.equal(reply.text, 'ок');
    assert.deepEqual(seen, { url: 'https://openrouter.ai/api/v1/chat/completions', auth: 'Bearer or-secret', model: MODEL });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('схемы инструментов Светы уходят в JSON Schema: типы строчными, у каждого инструмента есть parameters', async () => {
  const { TOOLS } = await import('./tools.ts');
  const { MEMORY_TOOLS } = await import('./memory.ts');
  const body = openRouterBody({ model: MODEL, system: 's', contents: [], tools: [...TOOLS, ...MEMORY_TOOLS], toolMode: 'AUTO' });
  const json = JSON.stringify(body.tools);
  assert.doesNotMatch(json, /"type":"(OBJECT|STRING|INTEGER|NUMBER|BOOLEAN|ARRAY)"/);
  for (const tool of body.tools as { function: { name: string; parameters?: { type?: string } } }[]) {
    assert.equal(tool.function.parameters?.type, 'object', `у ${tool.function.name} есть parameters`);
  }
});
