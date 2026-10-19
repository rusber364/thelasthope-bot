// Запрос к Google Gemini (generateContent по REST). Без SDK: один fetch, ответ разбираем сами.
// Документация: https://ai.google.dev/gemini-api/docs — generateContent, safety-settings, gemini-3 (thinking).

export interface GeminiContent {
  role: 'user' | 'model';
  parts: { text: string }[];
}

export interface GeminiRequest {
  apiKey: string;
  model: string;
  system: string;
  contents: GeminiContent[];
}

export interface GeminiReply {
  text: string;
  /** Сколько токенов ушло на запрос (для журнала). */
  tokens: number | null;
}

/** quota — исчерпан лимит (429); auth — неверный ключ; model — нет такой модели; blocked — ответ отфильтрован; unavailable — сеть или сбой Google. */
export type GeminiErrorKind = 'quota' | 'auth' | 'model' | 'blocked' | 'unavailable';

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
export function requestBody({ model, system, contents }: Omit<GeminiRequest, 'apiKey'>) {
  const thinks = !/gemini-(1|2)\./.test(model); // у 2.x свой параметр, thinkingLevel им не подходит
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    safetySettings: SAFETY,
    generationConfig: { maxOutputTokens: 1024, ...(thinks ? { thinkingConfig: { thinkingLevel: 'LOW' } } : {}) },
  };
}

interface ResponseJson {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
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
    throw new GeminiError('unavailable', message);
  }
  if (json.promptFeedback?.blockReason) throw new GeminiError('blocked', `Запрос отклонён фильтром: ${json.promptFeedback.blockReason}`);
  const candidate = json.candidates?.[0];
  if (candidate?.finishReason && BLOCKED.has(candidate.finishReason)) throw new GeminiError('blocked', `Ответ отфильтрован: ${candidate.finishReason}`);
  const text = (candidate?.content?.parts ?? [])
    .filter((part) => !part.thought && typeof part.text === 'string')
    .map((part) => part.text)
    .join('')
    .trim();
  return { text, tokens: json.usageMetadata?.totalTokenCount ?? null };
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
