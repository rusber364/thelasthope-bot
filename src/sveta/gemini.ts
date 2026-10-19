// Запрос к Google Gemini (generateContent по REST). Без SDK: один fetch, ответ разбираем сами.
// Документация: https://ai.google.dev/gemini-api/docs — generateContent, safety-settings, gemini-3 (thinking).

/** Кусок сообщения: текст, вызов инструмента или его результат. thoughtSignature Gemini 3 нужно вернуть как есть. */
export interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
  functionResponse?: { name: string; id?: string; response: Record<string, unknown> };
}

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

/** Описание инструмента для модели. */
export interface GeminiFunction {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

export interface GeminiRequest {
  apiKey: string;
  model: string;
  system: string;
  contents: GeminiContent[];
  tools?: GeminiFunction[];
  /** NONE — инструменты не вызывать, только ответить текстом (последний круг). */
  toolMode?: 'AUTO' | 'NONE';
}

export interface FunctionCall {
  name: string;
  args: Record<string, unknown>;
  id?: string;
}

export interface GeminiReply {
  text: string;
  /** Сколько токенов ушло на запрос (для журнала). */
  tokens: number | null;
  /** Инструменты, которые модель попросила вызвать. */
  calls: FunctionCall[];
  /** Ответ модели целиком — его возвращают в переписку вместе с результатами инструментов (с подписями мыслей). */
  content: GeminiContent;
}

/**
 * quota — исчерпан лимит (429); auth — неверный ключ; model — нет такой модели; blocked — ответ отфильтрован;
 * busy — Google перегружен или упал (5xx); unavailable — не ответил вовремя, сеть или непонятный ответ.
 */
export type GeminiErrorKind = 'quota' | 'auth' | 'model' | 'blocked' | 'busy' | 'unavailable';

export class GeminiError extends Error {
  readonly kind: GeminiErrorKind;
  constructor(kind: GeminiErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 30_000;

// Встроенные фильтры у Gemini 2.5 и 3 по умолчанию выключены — страхуемся от совсем грубого, подколы не режем.
const SAFETY = ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT'].map(
  (category) => ({ category, threshold: 'BLOCK_ONLY_HIGH' }),
);

/** Тело запроса. У Gemini 3 «обдумывание» по умолчанию глубокое и медленное — для болтовни хватает низкого. */
export function requestBody({ model, system, contents, tools, toolMode }: Omit<GeminiRequest, 'apiKey'>) {
  const thinks = !/gemini-(1|2)\./.test(model); // у 2.x свой параметр, thinkingLevel им не подходит
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    safetySettings: SAFETY,
    generationConfig: { maxOutputTokens: 1024, ...(thinks ? { thinkingConfig: { thinkingLevel: 'LOW' } } : {}) },
    ...(tools?.length ? { tools: [{ functionDeclarations: tools }], toolConfig: { functionCallingConfig: { mode: toolMode ?? 'AUTO' } } } : {}),
  };
}

interface ResponseJson {
  candidates?: { content?: { role?: string; parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { totalTokenCount?: number };
  error?: { message?: string; status?: string; details?: { reason?: string }[] };
}

const BLOCKED = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION']);

/** Разбор ответа (чистая функция): текст или понятная ошибка. */
export function parseResponse(status: number, json: ResponseJson): GeminiReply {
  if (status !== 200) {
    const message = json.error?.message ?? `HTTP ${status}`;
    const reason = json.error?.details?.map((d) => d.reason).join(' ') ?? '';
    if (status === 429 || json.error?.status === 'RESOURCE_EXHAUSTED') throw new GeminiError('quota', message);
    if (status === 401 || status === 403 || /API_KEY/.test(reason)) throw new GeminiError('auth', message);
    if (status === 400 && /api key/i.test(message)) throw new GeminiError('auth', message);
    if (status === 404) throw new GeminiError('model', message);
    if (status >= 500) throw new GeminiError('busy', message);
    throw new GeminiError('unavailable', message);
  }
  if (json.promptFeedback?.blockReason) throw new GeminiError('blocked', `Запрос отклонён фильтром: ${json.promptFeedback.blockReason}`);
  const candidate = json.candidates?.[0];
  if (candidate?.finishReason && BLOCKED.has(candidate.finishReason)) throw new GeminiError('blocked', `Ответ отфильтрован: ${candidate.finishReason}`);
  const parts = candidate?.content?.parts ?? [];
  const text = parts
    .filter((part) => !part.thought && typeof part.text === 'string')
    .map((part) => part.text)
    .join('')
    .trim();
  const calls = parts.flatMap((part) =>
    part.functionCall ? [{ name: part.functionCall.name, args: part.functionCall.args ?? {}, ...(part.functionCall.id ? { id: part.functionCall.id } : {}) }] : [],
  );
  return { text, tokens: json.usageMetadata?.totalTokenCount ?? null, calls, content: { role: 'model', parts } };
}

export async function generate(request: GeminiRequest): Promise<GeminiReply> {
  let response: Response;
  try {
    response = await fetch(`${ENDPOINT}/${encodeURIComponent(request.model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': request.apiKey },
      body: JSON.stringify(requestBody(request)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new GeminiError('unavailable', error instanceof Error ? error.message : String(error));
  }
  const json = (await response.json().catch(() => ({}))) as ResponseJson;
  return parseResponse(response.status, json);
}

/** Запасная модель, когда основная перегружена: лёгкая, быстрая и со своим бесплатным лимитом. */
export const FALLBACK_MODEL = 'gemini-flash-lite-latest';
export const RETRY_DELAY_MS = 2_000;

export interface SteadyDeps {
  generate: typeof generate;
  wait: (ms: number) => Promise<void>;
  /** Перед каждой попыткой (считаем запросы, обновляем «печатает…»). */
  onAttempt: (model: string) => void;
}

export interface SteadyReply {
  reply: GeminiReply;
  /** Какая модель ответила — следующие круги того же ответа идут к ней же. */
  model: string;
  /** Был повтор после перегрузки. */
  retried: boolean;
}

/**
 * Запрос с запасом на сбои Google. Перегрузка (5xx) — ещё раз той же моделью через 2 секунды;
 * снова не вышло или Google не ответил вовремя — лёгкая модель. Лимит, ключ, фильтр — сразу наверх.
 */
export async function generateSteady(request: GeminiRequest, deps: SteadyDeps): Promise<SteadyReply> {
  let model = request.model;
  let retried = false;
  for (;;) {
    deps.onAttempt(model);
    try {
      return { reply: await deps.generate({ ...request, model }), model, retried };
    } catch (error) {
      if (!(error instanceof GeminiError) || (error.kind !== 'busy' && error.kind !== 'unavailable')) throw error;
      // Перегрузка обычно проходит за секунды. После таймаута (30 с) ту же модель второй раз не ждём.
      if (error.kind === 'busy' && !retried && model === request.model) {
        retried = true;
        await deps.wait(RETRY_DELAY_MS);
        continue;
      }
      if (model === FALLBACK_MODEL) throw error;
      model = FALLBACK_MODEL;
    }
  }
}
