// Запросы к JSON API бота (/api/*). Вход — cookie-сессия, изменяющие запросы несут CSRF-токен из /api/me.
import type { ApiError, ApiMessage, MeResponse } from '@api';

/** Ошибка API: статус и русские тексты ошибок, которые можно показать как есть. */
export class ApiFailure extends Error {
  readonly status: number;
  readonly errors: string[];

  constructor(status: number, errors: string[]) {
    super(errors.join('\n'));
    this.status = status;
    this.errors = errors;
  }
}

let csrf = '';

/** Запоминаем токен из /api/me — его ждут все изменяющие запросы. */
export function rememberCsrf(me: MeResponse): void {
  csrf = me.csrf;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (method !== 'GET') headers['X-CSRF-Token'] = csrf;

  let response: Response;
  try {
    response = await fetch(`/api${path}`, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiFailure(0, ['Бот не отвечает. Проверь, что он запущен.']);
  }
  const type = response.headers.get('Content-Type') ?? '';
  const data: unknown = type.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const errors = (data as Partial<ApiError>)?.errors;
    throw new ApiFailure(response.status, Array.isArray(errors) && errors.length ? errors : [`Ошибка ${response.status}.`]);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T = ApiMessage>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T = ApiMessage>(path: string, body: unknown) => request<T>('PUT', path, body),
  delete: <T = ApiMessage>(path: string) => request<T>('DELETE', path),
};

/** Текст ошибки для уведомления. */
export function errorText(error: unknown): string {
  if (error instanceof ApiFailure) return error.errors.join('\n');
  return error instanceof Error ? error.message : String(error);
}
