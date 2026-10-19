// Файл историй Светы: скачать с вкладки «Истории о людях» и загрузить обратно — на другом компьютере,
// после правок в блокноте или чтобы вернуть удалённое. Без импортов: эти функции проверяют тесты бота.

export interface LoreEntry {
  names: string[];
  story: string;
}

const clean = (entry: LoreEntry): LoreEntry => ({ names: entry.names.map((n) => n.trim()).filter(Boolean), story: entry.story.trim() });

/** Содержимое файла для скачивания (пустые карточки не попадают). */
export function loreFile(lore: LoreEntry[]): string {
  const entries = lore.map(clean).filter((entry) => entry.names.length || entry.story);
  return `${JSON.stringify({ kind: 'sveta-lore', version: 1, lore: entries }, null, 2)}\n`;
}

/** Разобрать файл: { kind: 'sveta-lore', lore: [...] } или просто массив историй. null — это не файл историй. */
export function parseLoreFile(text: string): LoreEntry[] | null {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return null;
  }
  const list = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { lore?: unknown }).lore)
      ? (data as { lore: unknown[] }).lore
      : null;
  if (!list) return null;
  const entries = list.flatMap((item): LoreEntry[] => {
    if (!item || typeof item !== 'object') return [];
    const { names, story } = item as Record<string, unknown>;
    if (!Array.isArray(names) || typeof story !== 'string') return [];
    const entry = clean({ names: names.filter((n): n is string => typeof n === 'string'), story });
    return entry.names.length && entry.story ? [entry] : [];
  });
  // В файле что-то было, но ни одной истории не нашлось — значит, это не наш файл.
  return list.length && !entries.length ? null : entries;
}

const norm = (name: string) => name.trim().toLowerCase().replaceAll('ё', 'е');
const samePerson = (a: LoreEntry, b: LoreEntry) => a.names.some((name) => b.names.some((other) => norm(name) === norm(other)));
const sameEntry = (a: LoreEntry, b: LoreEntry) => JSON.stringify(clean(a)) === JSON.stringify(clean(b));

/** Добавить истории из файла: тот же человек (совпало хоть одно имя) — обновить, новый — дописать в конец. Ничего не удаляет. */
export function mergeLore(current: LoreEntry[], incoming: LoreEntry[]): { lore: LoreEntry[]; added: number; updated: number } {
  const lore = [...current];
  let added = 0;
  let updated = 0;
  for (const entry of incoming) {
    const index = lore.findIndex((existing) => samePerson(existing, entry));
    if (index < 0) {
      lore.push(entry);
      added++;
    } else if (!sameEntry(lore[index]!, entry)) {
      lore[index] = entry;
      updated++;
    }
  }
  return { lore, added, updated };
}
