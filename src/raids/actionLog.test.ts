import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.BOT_DB_PATH = ':memory:';
const { raidActionEntry } = await import('./actionLog.ts');

const signup = (specId: string, tentative = false) => ({ raidId: 1, userId: 'u1', specId, displayName: 'Тест', tentative, reserve: false, createdAt: 1 });

test('новая запись и отписка', () => {
  assert.match(raidActionEntry(null, signup('mage_fire'))?.title ?? '', /Запись на рейд/);
  const left = raidActionEntry(signup('mage_fire'), null);
  assert.match(left?.title ?? '', /Отписка/);
  assert.match(left?.change ?? '', /Маг — Огонь/);
});

test('смена спека показывает было и стало', () => {
  const entry = raidActionEntry(signup('mage_fire'), signup('mage_frost'));
  assert.match(entry?.title ?? '', /Смена специализации/);
  assert.match(entry?.change ?? '', /Огонь.*→.*Лёд/);
});

test('«под вопросом» и возврат в состав', () => {
  assert.match(raidActionEntry(signup('mage_fire'), signup('mage_fire', true))?.title ?? '', /под вопросом/);
  assert.match(raidActionEntry(signup('mage_fire', true), signup('mage_fire'))?.title ?? '', /Снова в основном списке/);
});

test('повторный выбор того же спека не логируется', () => {
  assert.equal(raidActionEntry(signup('mage_fire'), signup('mage_fire')), null);
  assert.equal(raidActionEntry(null, null), null);
});
