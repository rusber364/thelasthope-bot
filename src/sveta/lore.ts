// Истории о людях гильдии, которые рассказали Свете офицеры (админка → «Света» → «Истории о людях»).
// Света их только читает. В запрос попадают лишь истории тех, кого назвали в сообщении, и автора (loreFor) —
// остальные не тратят лимит и не путаются: раньше Света приписывала байку одного человека другому и повторяла её в каждом ответе.
import type { LoreEntry } from '../botSettings.ts';

/** Сколько историй самое большее кладём в один запрос. */
const MAX_IN_PROMPT = 3;

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

/** Основы слов от 5 букв: «огурцами» и «огурцы» — «огурц». */
const stems = (text: string) =>
  new Set(
    norm(text)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 5)
      .map((word) => word.slice(0, 5)),
  );

/**
 * Света недавно уже шутила по этой истории: в её последних репликах есть хотя бы два слова из истории (кроме имён).
 * Такую историю без прямого вопроса не подсовываем — иначе она вставляет одну и ту же байку в каждый ответ.
 */
export function usedRecently(entry: LoreEntry, svetaLines: readonly string[]): boolean {
  const said = stems(svetaLines.join('\n'));
  const names = stems(entry.names.join(' '));
  let hits = 0;
  for (const stem of stems(entry.story)) if (!names.has(stem) && said.has(stem) && ++hits >= 2) return true;
  return false;
}

/**
 * Истории для ответа: о тех, кого назвали в последнем сообщении (asked — его текст), всегда; об авторе (authorName) —
 * если Света по ней недавно не шутила. Истории остальных собеседников не берём: модель путает, чья байка чья.
 */
export function loreFor(entries: readonly LoreEntry[], asked: readonly string[], authorName: string, svetaLines: readonly string[]): LoreEntry[] {
  const named = matchLore(entries, asked);
  const own = matchLore(entries, [authorName]).filter((entry) => !named.includes(entry) && !usedRecently(entry, svetaLines));
  return [...named, ...own].slice(0, MAX_IN_PROMPT);
}

/** Истории для системной инструкции. */
export function loreText(entries: readonly LoreEntry[]): string {
  return entries.map((entry) => `- ${entry.names.join(' / ')}: ${entry.story}`).join('\n');
}
