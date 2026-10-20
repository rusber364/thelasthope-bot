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
  /** Ответ модели OpenRouter целиком (с reasoning_details) — уходит обратно в переписку без изменений. */
  raw?: Record<string, unknown>;
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
 * quota — дневной лимит (429); rate — лимит в минуту (429); auth — неверный ключ; model — нет такой модели;
 * blocked — ответ отфильтрован; busy — Google перегружен или упал (5xx); unavailable — не ответил вовремя, сеть или непонятный ответ.
 */
export type GeminiErrorKind = 'quota' | 'rate' | 'auth' | 'model' | 'blocked' | 'busy' | 'unavailable';

export class GeminiError extends Error {
  readonly kind: GeminiErrorKind;
  /** Через сколько Google советует повторить (у 429). */
  readonly retryMs: number | null;
  constructor(kind: GeminiErrorKind, message: string, retryMs: number | null = null) {
    super(message);
    this.kind = kind;
    this.retryMs = retryMs;
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
  error?: {
    message?: string;
    status?: string;
    // ErrorInfo (reason), QuotaFailure (violations[].quotaId), RetryInfo (retryDelay: "37s").
    details?: { reason?: string; retryDelay?: string; violations?: { quotaId?: string }[] }[];
  };
}

const BLOCKED = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION']);

/** 429: какой лимит кончился. Дневной тоже присылает «повтори через N секунд» — поэтому сначала смотрим на имя квоты. */
function limitError(message: string, details: NonNullable<NonNullable<ResponseJson['error']>['details']>): GeminiError {
  const quotaIds = details.flatMap((detail) => detail.violations ?? []).map((violation) => violation.quotaId ?? '');
  const delay = details.find((detail) => detail.retryDelay)?.retryDelay ?? /retry in ([\d.]+\s*s)/i.exec(message)?.[1];
  const seconds = Number.parseFloat(delay ?? '');
  const retryMs = Number.isFinite(seconds) ? Math.ceil(seconds * 1000) : null;
  const daily = quotaIds.some((id) => /PerDay/i.test(id));
  const perMinute = quotaIds.some((id) => /PerMinute/i.test(id)) || retryMs !== null;
  return new GeminiError(!daily && perMinute ? 'rate' : 'quota', message, retryMs);
}

/** Разбор ответа (чистая функция): текст или понятная ошибка. */
export function parseResponse(status: number, json: ResponseJson): GeminiReply {
  if (status !== 200) {
    const message = json.error?.message ?? `HTTP ${status}`;
    const reason = json.error?.details?.map((d) => d.reason).join(' ') ?? '';
    if (status === 429 || json.error?.status === 'RESOURCE_EXHAUSTED') throw limitError(message, json.error?.details ?? []);
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

/** Запасная модель по умолчанию: лёгкая, быстрая и со своим бесплатным лимитом (лимиты у Google — на каждую модель отдельно). */
export const FALLBACK_MODEL = 'gemini-flash-lite-latest';
export const RETRY_DELAY_MS = 2_000;

const MINUTE = 60_000;

/** Какие модели сейчас отдыхают после сбоя или лимита: пока отдыхает — запросы сразу к другой, лимит зря не тратится. */
export class ModelRest {
  private readonly until = new Map<string, number>();

  ready(model: string, now: number): boolean {
    return (this.until.get(model) ?? 0) <= now;
  }

  rest(model: string, until: number): void {
    this.until.set(model, until);
  }
}

/** Сколько модель отдыхает: лимит в минуту — сколько сказал Google; дневной — час (потом пробуем снова); сбой — 5 минут. */
export function restMs(error: GeminiError): number {
  if (error.kind === 'rate') return Math.min(Math.max(error.retryMs ?? MINUTE, 10_000), 5 * MINUTE);
  if (error.kind === 'quota') return 60 * MINUTE;
  return 5 * MINUTE;
}

/** Модели по порядку (основная, потом запасная) — без пустых, повторов и тех, что отдыхают. */
export function readyModels(models: (string | null | undefined)[], rest: ModelRest, now: number): string[] {
  return [...new Set(models.filter((m): m is string => Boolean(m)))].filter((m) => rest.ready(m, now));
}

/** Сбои, после которых стоит попробовать другую модель. Ключ, фильтр, нет модели — другая не поможет. */
const RECOVERABLE = new Set<GeminiErrorKind>(['busy', 'unavailable', 'rate', 'quota']);

export interface SteadyDeps {
  generate: typeof generate;
  wait: (ms: number) => Promise<void>;
  now: () => number;
  rest: ModelRest;
  /** Перед каждой попыткой (считаем запросы, обновляем «печатает…»). */
  onAttempt: (model: string) => void;
  /** Модель не ответила (для лога). */
  onFailure: (model: string, error: GeminiError) => void;
  /** Запасная модель (пусто — без запасной). */
  fallback: string;
  /** Ключ для модели: у Gemini и OpenRouter свои; модели без ключа пропускаются. */
  keyFor: (model: string) => string | undefined;
}

export interface SteadyReply {
  reply: GeminiReply;
  /** Какая модель ответила — следующие круги того же ответа идут к ней же. */
  model: string;
}

/**
 * Запрос с запасом на сбои. Перегрузка (5xx) — ещё раз той же моделью через 2 секунды; снова не вышло, модель не ответила
 * вовремя или кончился её лимит — она отдыхает, а запрос идёт к запасной. Ключ, фильтр — сразу наверх.
 */
export async function generateSteady(request: GeminiRequest, deps: SteadyDeps): Promise<SteadyReply> {
  let failure: GeminiError | null = null;
  const models = [request.model, deps.fallback].filter((m) => m && deps.keyFor(m));
  for (const model of readyModels(models, deps.rest, deps.now())) {
    for (let attempt = 1; ; attempt++) {
      deps.onAttempt(model);
      try {
        return { reply: await deps.generate({ ...request, model, apiKey: deps.keyFor(model) ?? '' }), model };
      } catch (error) {
        if (!(error instanceof GeminiError) || !RECOVERABLE.has(error.kind)) throw error;
        failure = error;
        deps.onFailure(model, error);
        // Перегрузка обычно проходит за секунды. После таймаута (30 с) ту же модель второй раз не ждём.
        if (error.kind === 'busy' && attempt === 1) {
          await deps.wait(RETRY_DELAY_MS);
          continue;
        }
        deps.rest.rest(model, deps.now() + restMs(error));
        break;
      }
    }
  }
  throw failure ?? new GeminiError('rate', 'Все модели отдыхают после сбоя или лимита.');
}
