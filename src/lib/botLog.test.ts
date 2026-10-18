import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.BOT_DB_PATH = ':memory:';
const { captureConsole, readBotLog, recordBotLog, trimBotLog } = await import('./botLog.ts');
const { db } = await import('../db.ts');

const texts = (entries: { text: string }[]) => entries.map((e) => e.text);

test('лог: новые строки первыми, фильтр по уровню, поиск без учёта регистра, «показать ещё»', () => {
  db.exec('DELETE FROM bot_log');
  recordBotLog('start', 'Бот запускается');
  recordBotLog('info', '📅 Открыта рега #18 «Рейд» в #рега-1');
  recordBotLog('warn', 'Связь с Discord прервана (код 1006).');
  recordBotLog('error', 'Ошибка планировщика рейдов: DiscordAPIError');
  recordBotLog('info', `${String.fromCharCode(27)}[32mзелёный текст${String.fromCharCode(27)}[39m`);

  assert.deepEqual(texts(readBotLog().entries), [
    'зелёный текст',
    'Ошибка планировщика рейдов: DiscordAPIError',
    'Связь с Discord прервана (код 1006).',
    '📅 Открыта рега #18 «Рейд» в #рега-1',
    'Бот запускается',
  ]);
  assert.deepEqual(texts(readBotLog({ filter: 'warn' }).entries), ['Ошибка планировщика рейдов: DiscordAPIError', 'Связь с Discord прервана (код 1006).', 'Бот запускается']);
  assert.deepEqual(texts(readBotLog({ filter: 'error' }).entries), ['Ошибка планировщика рейдов: DiscordAPIError', 'Бот запускается'], 'запуски видны при любом фильтре');
  assert.deepEqual(texts(readBotLog({ search: 'РЕГА #18' }).entries), ['📅 Открыта рега #18 «Рейд» в #рега-1']);

  const first = readBotLog({ limit: 2 });
  assert.equal(first.entries.length, 2);
  assert.equal(first.hasMore, true);
  const more = readBotLog({ limit: 2, before: first.entries.at(-1)!.id });
  assert.deepEqual(texts(more.entries), ['Связь с Discord прервана (код 1006).', '📅 Открыта рега #18 «Рейд» в #рега-1']);
});

test('хранятся только последние строки', () => {
  db.exec('DELETE FROM bot_log');
  for (let i = 1; i <= 30; i++) recordBotLog('info', `строка ${i}`);
  trimBotLog(10);
  const { entries } = readBotLog();
  assert.equal(entries.length, 10);
  assert.equal(entries[0]!.text, 'строка 30');
  assert.equal(entries.at(-1)!.text, 'строка 21');
});

test('console.* попадает в лог как есть, с подстановками и ошибками', () => {
  db.exec('DELETE FROM bot_log');
  captureConsole();
  console.log('📅 Открыта рега #%d «%s»', 18, 'Рейд');
  console.warn('⚠️ Канал не найден');
  console.error('Не удалось записать:', new Error('Missing Access'));
  const { entries } = readBotLog();
  assert.equal(entries.at(-1)!.level, 'start', 'отметка запуска — первая');
  assert.deepEqual(
    entries.slice(0, 3).map((e) => [e.level, e.text.split('\n')[0]]),
    [
      ['error', 'Не удалось записать: Error: Missing Access'],
      ['warn', '⚠️ Канал не найден'],
      ['info', '📅 Открыта рега #18 «Рейд»'],
    ],
  );
  assert.match(entries[0]!.text, /at /, 'у ошибки сохраняется стек');
});
