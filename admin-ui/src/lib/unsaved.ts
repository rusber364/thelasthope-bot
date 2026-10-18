// Какие разделы настроек сейчас с несохранёнными изменениями — чтобы переспросить перед уходом со страницы.
const dirty = new Set<string>();

export function markDirty(key: string, value: boolean): void {
  if (value) dirty.add(key);
  else dirty.delete(key);
}

export const hasUnsaved = (): boolean => dirty.size > 0;
