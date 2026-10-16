// Резервные копии базы: бот сам раз в сутки копирует data/bot.db в data/backups/ и хранит последние BACKUP_KEEP копий.
// Копия делается «на ходу» встроенным в SQLite механизмом — бота останавливать не нужно. Вручную: `pnpm backup`.
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backup } from 'node:sqlite';
import { db } from '../db.ts';
import { settings } from '../settings.ts';

export const BACKUP_KEEP = 14;
const DAY = 24 * 60 * 60 * 1000;
const CHECK_EVERY_MS = 60 * 60 * 1000;
const NAME = /^bot-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}\.db$/;

/** Папка для копий: BOT_BACKUP_DIR или data/backups рядом с базой. */
export function backupDir(): string {
  return process.env.BOT_BACKUP_DIR ?? fileURLToPath(new URL('../../data/backups/', import.meta.url));
}

/** Копии в папке — новые первыми. */
export function listBackups(dir = backupDir()): { name: string; path: string; time: number }[] {
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((name) => NAME.test(name));
  } catch {
    return [];
  }
  return names.map((name) => ({ name, path: join(dir, name), time: statSync(join(dir, name)).mtimeMs })).sort((a, b) => b.time - a.time);
}

/** Сделать копию базы и удалить лишние старые. Возвращает путь к новой копии. */
export async function backupDatabase(dir = backupDir(), now = Date.now(), keep = BACKUP_KEEP): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const stamp = Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(settings.timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  const path = join(dir, `bot-${stamp.year}-${pad(stamp.month)}-${pad(stamp.day)}_${pad(stamp.hour)}-${pad(stamp.minute)}.db`);
  await backup(db, path);
  for (const old of listBackups(dir).slice(keep)) rmSync(old.path, { force: true });
  return path;
}

/** Раз в час проверяем: если последней копии больше суток (или копий нет) — делаем новую. */
export function startDailyBackup(): void {
  const check = async () => {
    const latest = listBackups()[0];
    if (latest && Date.now() - latest.time < DAY) return;
    const path = await backupDatabase();
    console.log(`💾 Резервная копия базы: ${path}`);
  };
  const run = () => void check().catch((error) => console.error('Не удалось сделать резервную копию базы:', error));
  run();
  setInterval(run, CHECK_EVERY_MS);
}
