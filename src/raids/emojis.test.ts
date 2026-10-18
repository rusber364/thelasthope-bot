import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { UI_ICONS } from './emojis.ts';

test('значки ролей из игры лежат в assets/role-icons и годятся для эмодзи Discord', () => {
  const files = Object.values(UI_ICONS).flatMap((source) => (typeof source === 'string' ? [] : [source.file]));
  assert.ok(files.length >= 3, 'танк, лекарь и боец — из файлов');
  for (const file of files) {
    const data = readFileSync(new URL(`../../assets/role-icons/${file}`, import.meta.url));
    assert.equal(data.subarray(1, 4).toString(), 'PNG', `${file} — PNG`);
    assert.ok(data.length < 256 * 1024, `${file} меньше 256 КБ — больше Discord не примет`);
  }
});
