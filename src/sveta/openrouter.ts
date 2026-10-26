// Модели через OpenRouter (openrouter.ai): один ключ OPENROUTER_API_KEY — сотни моделей, в том числе бесплатные
// (id с «:free», например minimax/minimax-m3.1-flash:free). API в формате OpenAI Chat Completions; переписка Светы
// хранится в формате Gemini, поэтому здесь — перевод туда и обратно. Ответ с вызовом инструментов возвращается
// в переписку как есть (с reasoning_details), как и у Gemini 3 с подписями мыслей.
// Документация: https://openrouter.ai/docs — chat completions, tool calling, reasoning tokens, errors.
import { GeminiError, type FunctionCall, type GeminiContent, type GeminiReply, type GeminiRequest } from './gemini.ts';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const TIMEOUT_MS = 30_000;

/** Модель OpenRouter — с «/» в имени (vendor/model), модели Gemini — без. */
export const isOpenRouterModel = (model: string) => model.includes('/');

type Message = Record<string, unknown>;

/** Переписка в формате Gemini → сообщения OpenAI: system, user, assistant (с tool_calls), tool (результаты). */
export function toMessages(system: string, contents: GeminiContent[]): Message[] {
  const messages: Message[] = [{ role: 'system', content: system }];
  for (const content of contents) {
    if (content.raw) {
      messages.push(content.raw);
      continue;
    }
    const text = content.parts
      .filter((part) => !part.thought && typeof part.text === 'string')
      .map((part) => part.text)
      .join('');
    if (content.role === 'model') {
      const calls = content.parts.flatMap((part, i) =>
        part.functionCall
          ? [{ id: part.functionCall.id ?? `call_${i}`, type: 'function', function: { name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args ?? {}) } }]
          : [],
      );
      messages.push(calls.length ? { role: 'assistant', content: text || null, tool_calls: calls } : { role: 'assistant', content: text });
      continue;
    }
    for (const [i, part] of content.parts.entries()) {
      if (part.functionResponse) {
        messages.push({ role: 'tool', tool_call_id: part.functionResponse.id ?? `call_${i}`, content: JSON.stringify(part.functionResponse.response) });
      }
    }
    if (text) messages.push({ role: 'user', content: text });
  }
  return messages;
}

/** Схема параметров в JSON Schema: типы Gemini (OBJECT, STRING, INTEGER) — строчными. */
export function toJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toJsonSchema);
  if (!schema || typeof schema !== 'object') return schema;
  return Object.fromEntries(Object.entries(schema).map(([key, value]) => [key, key === 'type' && typeof value === 'string' ? value.toLowerCase() : toJsonSchema(value)]));
}

/** Инструмент без параметров: MiniMax без поля parameters отвечает «function parameters is empty». */
const NO_PARAMETERS = { type: 'object', properties: {} };

/** Тело запроса. Размышления по умолчанию короткие: для болтовни глубокие не нужны, а они тратят время и токены. */
export function openRouterBody({ model, system, contents, tools, toolMode, thinking = 'low' }: Omit<GeminiRequest, 'apiKey'>) {
  return {
    model,
    messages: toMessages(system, contents),
    max_tokens: 2048,
    reasoning: { effort: thinking },
    // Инструменты передаём и на последнем круге: в переписке уже есть их вызовы, по ним OpenRouter проверяет схему.
    ...(tools?.length
      ? {
          tools: tools.map((fn) => ({ type: 'function', function: { ...fn, parameters: fn.parameters ? toJsonSchema(fn.parameters) : NO_PARAMETERS } })),
          tool_choice: toolMode === 'NONE' ? 'none' : 'auto',
        }
      : {}),
  };
}

interface ResponseJson {
  choices?: { message?: { content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] } & Record<string, unknown>; finish_reason?: string }[];
  /** cost — в кредитах OpenRouter (= долларах); у бесплатных моделей 0. */
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  error?: { code?: number; message?: string; metadata?: { raw?: unknown } };
}

const parseArgs = (raw: string | undefined): Record<string, unknown> => {
  try {
    const value = JSON.parse(raw || '{}') as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

/** Разбор ответа (чистая функция): текст и вызовы инструментов или понятная ошибка тех же видов, что у Gemini. */
export function parseOpenRouter(status: number, json: ResponseJson): GeminiReply {
  const code = json.error?.code ?? status;
  if (status !== 200 || json.error) {
    const message = json.error?.message ?? `HTTP ${status}`;
    if (code === 429) throw new GeminiError(/per[- ]day/i.test(message) ? 'quota' : 'rate', message);
    if (code === 402) throw new GeminiError('quota', message);
    // Дневной (недельный, месячный) лимит ключа из настроек OpenRouter — как дневная квота: модель отдыхает, отвечает запасная.
    if (code === 403 && /key limit/i.test(message)) throw new GeminiError('quota', message);
    if (code === 401 || code === 403) throw new GeminiError('auth', message);
    if (code === 404 || (code === 400 && /not a valid model|model.*not (found|exist)/i.test(message))) throw new GeminiError('model', message);
    if (code >= 500) throw new GeminiError('busy', message);
    throw new GeminiError('unavailable', message);
  }
  const choice = json.choices?.[0];
  if (choice?.finish_reason === 'content_filter') throw new GeminiError('blocked', 'Ответ отфильтрован провайдером модели.');
  const message = choice?.message ?? {};
  // Рассуждения приходят отдельным полем reasoning; на случай моделей, что пишут их в текст, — убираем <think>.
  const text = (message.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const calls: FunctionCall[] = (message.tool_calls ?? []).flatMap((call) =>
    call.function?.name ? [{ name: call.function.name, args: parseArgs(call.function.arguments), ...(call.id ? { id: call.id } : {}) }] : [],
  );
  const parts = [...(text ? [{ text }] : []), ...calls.map((call) => ({ functionCall: call }))];
  return {
    text,
    usage: json.usage
      ? { input: json.usage.prompt_tokens ?? 0, output: json.usage.completion_tokens ?? 0, cost: typeof json.usage.cost === 'number' ? json.usage.cost : null }
      : null,
    calls,
    // С вызовами — сохраняем сообщение модели (вызовы как есть и reasoning_details), чтобы вернуть его на следующем круге.
    content: {
      role: 'model',
      parts,
      ...(calls.length
        ? {
            raw: {
              role: 'assistant',
              content: message.content ?? null,
              tool_calls: message.tool_calls,
              ...(message.reasoning_details ? { reasoning_details: message.reasoning_details } : {}),
            },
          }
        : {}),
    },
  };
}

export async function generateOpenRouter(request: GeminiRequest): Promise<GeminiReply> {
  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      // Значения заголовков — только ASCII (тире «—» здесь роняет fetch).
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${request.apiKey}`, 'X-Title': 'The Last Hope - Sveta' },
      body: JSON.stringify(openRouterBody(request)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new GeminiError('unavailable', error instanceof Error ? error.message : String(error));
  }
  const json = (await response.json().catch(() => ({}))) as ResponseJson;
  return parseOpenRouter(response.status, json);
}
