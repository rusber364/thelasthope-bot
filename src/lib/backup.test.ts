import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, test } from 'node:test';

process.env.BOT_DB_PATH = ':memory:';
const { backupDatabase, listBackups } = await import('./backup.ts');
const { getSettings, saveSettings } = await import('../botSettings.ts');

const dir = mkdtempSync(join(tmpdir(), 'tlh-backup-'));
after(() => rmSync(dir, { recursive: true, force: true }));

test('копия — рабочая база с теми же данными', async () => {
  const s = structuredClone(getSettings());
  s.welcome.text = 'Проверка резервной копии';
  saveSettings(s);

  const path = await backupDatabase(dir, Date.UTC(2026, 9, 16, 9, 30));
  assert.match(path, /bot-2026-10-16_12-30\.db$/, 'имя — по киевскому времени');
  const copy = new DatabaseSync(path, { readOnly: true });
  const row = copy.prepare("SELECT value FROM settings WHERE key = 'bot'").get() as { value: string };
  copy.close();
  assert.equal(JSON.parse(row.value).welcome.text, 'Проверка резервной копии');
});

test('хранятся только последние копии', async () => {
  for (let day = 1; day <= 5; day++) {
    const path = await backupDatabase(dir, Date.UTC(2026, 9, day, 3, 0), 3);
    const at = new Date(Date.UTC(2026, 9, day, 3, 0));
    utimesSync(path, at, at); // время файла = время копии, чтобы порядок был как в жизни
  }
  await backupDatabase(dir, Date.UTC(2026, 9, 6, 3, 0), 3);
  const names = listBackups(dir).map((b) => b.name);
  assert.equal(names.length, 3);
  assert.ok(names.includes('bot-2026-10-06_06-00.db'), 'свежая на месте');
  assert.ok(!names.includes('bot-2026-10-01_06-00.db'), 'самая старая удалена');
});
