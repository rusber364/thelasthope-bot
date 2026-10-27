// Истории о людях гильдии, которые рассказали Свете офицеры (админка → «Света» → «Истории о людях»).
// Света их только читает. В запрос попадают лишь истории тех, кого назвали в разговоре или кто в нём участвует, —
// остальные не тратят лимит Gemini.
import type { LoreEntry } from '../botSettings.ts';

/** Сколько историй самое большее кладём в один запрос. */
const MAX_IN_PROMPT = 5;

/** Для поиска имён: без регистра, «ё» = «е». */
export const norm = (text: string) => text.toLowerCase().replaceAll('ё', 'е');
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Совпадает ли имя: целое слово с окончанием до трёх букв — «Эльына», «Кембэлу», «Нобухидзе»,
 * но не «орфография» для «Орф». haystack — уже через norm.
 */
export function mentioned(name: string, haystack: string): boolean {
  const n = norm(name.trim());
  if (n.length < 2) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escape(n)}\\p{L}{0,3}(?![\\p{L}\\p{N}])`, 'u').test(haystack);
}

/** Истории, чьё имя или ник встречается в разговоре (в тексте сообщений или в именах собеседников). */
export function matchLore(entries: readonly LoreEntry[], texts: readonly string[]): LoreEntry[] {
  const haystack = norm(texts.join('\n'));
  return entries.filter((entry) => entry.names.some((name) => mentioned(name, haystack))).slice(0, MAX_IN_PROMPT);
}

/** Истории для системной инструкции. */
export function loreText(entries: readonly LoreEntry[]): string {
  return entries.map((entry) => `- ${entry.names.join(' / ')}: ${entry.story}`).join('\n');
}
