// Что Света видит перед ответом: последние сообщения канала в формате переписки для Gemini.
import type { GeminiContent } from './gemini.ts';

/** Одно сообщение чата. fromSveta — её собственная реплика. */
export interface ChatLine {
  name: string;
  text: string;
  fromSveta: boolean;
}

/** Сколько последних сообщений канала Света видит. */
export const HISTORY = 15;
const LINE_LIMIT = 600;
const REPLY_LIMIT = 1900; // Discord — до 2000 символов в сообщении

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Текст сообщения: упоминания уже именами (cleanContent), вложения и стикеры — словами. */
export function lineText(content: string, attachments: number, stickers: number): string {
  const extras = [attachments ? '[картинка или файл]' : '', stickers ? '[стикер]' : ''].filter(Boolean);
  return [content.trim(), ...extras].filter(Boolean).join(' ');
}

/**
 * Переписка для модели: реплики Светы — от лица модели, остальные — «Имя: текст».
 * Подряд идущие сообщения людей склеиваются в одно, а начинается переписка всегда с людей.
 */
export function buildContents(lines: ChatLine[]): GeminiContent[] {
  const contents: GeminiContent[] = [];
  for (const line of lines) {
    const text = clip(line.text.trim(), LINE_LIMIT);
    if (!text) continue;
    const role = line.fromSveta ? 'model' : 'user';
    const value = line.fromSveta ? text : `${line.name}: ${text}`;
    const last = contents.at(-1);
    if (last?.role === role) last.parts[0]!.text = `${last.parts[0]!.text ?? ''}\n${value}`;
    else contents.push({ role, parts: [{ text: value }] });
  }
  while (contents[0]?.role === 'model') contents.shift();
  return contents;
}

/**
 * Вызов инструмента, который модель написала текстом вместо настоящего вызова («change_attitude: {"change": -12}»,
 * «remember({...})», просто «change_attitude») — так изредка делает Grok. null — обычный ответ.
 */
export function textToolCall(text: string, names: ReadonlySet<string>): { name: string; args: Record<string, unknown> } | null {
  const match = /^\s*`*([a-z_]+)`*\s*[:(]?\s*(\{[\s\S]*\})?\s*\)?\s*$/.exec(text);
  if (!match || !names.has(match[1]!)) return null;
  try {
    const args = match[2] ? (JSON.parse(match[2]) as unknown) : {};
    return { name: match[1]!, args: args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {} };
  } catch {
    return { name: match[1]!, args: {} };
  }
}

/** Ответ модели → сообщение в Discord: без «Света:» в начале, без живых @everyone/@here, не длиннее лимита. */
export function cleanReply(text: string): string {
  const reply = text
    .replace(/^\s*\**\s*света\s*\**\s*:\s*\**\s*/i, '') // «Света:», «**Света:**», «**Света**:»
    .replace(/@(everyone|here)/gi, '@​$1')
    .trim();
  return clip(reply, REPLY_LIMIT);
}
