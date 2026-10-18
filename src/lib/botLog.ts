// Лог бота: всё, что бот пишет в консоль, дублируется в базу. Его видно в админке на странице «Лог бота» —
// даже если бот работает на сервере без окна консоли или успел перезапуститься.
import { format } from 'node:util';
import { db } from '../db.ts';

export type BotLogLevel = 'start' | 'info' | 'warn' | 'error';

export interface BotLogEntry {
  id: number;
  /** Когда (мс с 1970 года). */
  at: number;
  level: BotLogLevel;
  text: string;
}

/** Сколько последних строк хранить. */
export const KEEP_ENTRIES = 5000;
const TEXT_LIMIT = 4000;
// Цвета терминала (\x1b[…m) в админке не нужны.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

let sinceTrim = 0;

/** Записать строку в лог (в консоль она не выводится — для этого есть console.*). */
export function recordBotLog(level: BotLogLevel, text: string, at = Date.now()): void {
  try {
    db.prepare('INSERT INTO bot_log (at, level, text) VALUES (?, ?, ?)').run(at, level, text.replace(ANSI, '').slice(0, TEXT_LIMIT));
    if (++sinceTrim >= 100) {
      sinceTrim = 0;
      trimBotLog();
    }
  } catch {
    // База недоступна — строка всё равно осталась в консоли.
  }
}

/** Оставить только последние keep строк. */
export function trimBotLog(keep = KEEP_ENTRIES): void {
  db.prepare('DELETE FROM bot_log WHERE id <= (SELECT MAX(id) FROM bot_log) - ?').run(keep);
}

let captured = false;

/** Дублировать console.log / info / warn / error в лог бота. Вызывается один раз при запуске. */
export function captureConsole(): void {
  if (captured) return;
  captured = true;
  const methods = [
    ['log', 'info'],
    ['info', 'info'],
    ['warn', 'warn'],
    ['error', 'error'],
  ] as const;
  for (const [method, level] of methods) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      original(...args);
      recordBotLog(level, format(...args));
    };
  }
  recordBotLog('start', `Бот запускается (Node ${process.version}, процесс ${process.pid})`);
  // Падение процесса: обработчик только записывает — Node, как и раньше, сам выведет ошибку и завершит бота.
  process.on('uncaughtExceptionMonitor', (error, origin) => recordBotLog('error', `Бот падает (${origin}): ${format(error)}`));
}

/** all — всё; warn — предупреждения и ошибки; error — только ошибки. Запуски бота видны при любом фильтре. */
export type BotLogFilter = 'all' | 'warn' | 'error';

const LEVELS: Record<BotLogFilter, ReadonlySet<BotLogLevel>> = {
  all: new Set(['start', 'info', 'warn', 'error']),
  warn: new Set(['start', 'warn', 'error']),
  error: new Set(['start', 'error']),
};

/** Строки лога, новые первыми: до limit штук старше before (id), с поиском по тексту без учёта регистра. */
export function readBotLog(options: { filter?: BotLogFilter; search?: string; before?: number | null; limit?: number } = {}): {
  entries: BotLogEntry[];
  hasMore: boolean;
} {
  const { filter = 'all', search = '', before = null, limit = 200 } = options;
  const levels = LEVELS[filter];
  const needle = search.trim().toLowerCase();
  // Строк не больше KEEP_ENTRIES, поэтому фильтруем здесь: SQLite не умеет без учёта регистра для кириллицы.
  const rows = (
    before ? db.prepare('SELECT * FROM bot_log WHERE id < ? ORDER BY id DESC').all(before) : db.prepare('SELECT * FROM bot_log ORDER BY id DESC').all()
  ) as { id: number; at: number; level: BotLogLevel; text: string }[];
  const matching = rows.filter((row) => levels.has(row.level) && (!needle || row.text.toLowerCase().includes(needle)));
  return {
    entries: matching.slice(0, limit).map((row) => ({ id: Number(row.id), at: Number(row.at), level: row.level, text: String(row.text) })),
    hasMore: matching.length > limit,
  };
}
