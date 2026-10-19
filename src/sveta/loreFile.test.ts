// Файл историй Светы из админки (admin-ui/src/lib/lore.ts): истории владельцу важны — проверяем, что ничего не теряется.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loreFile, mergeLore, parseLoreFile } from '../../admin-ui/src/lib/lore.ts';

const elyn = { names: ['Эльын', 'Нобухидзе'], story: 'Живёт у леса с медведями и лосями.' };
const kembel = { names: ['Кембэл'], story: 'Любит медовуху.' };

test('скачать и загрузить обратно — те же истории; пустые карточки и пробелы по краям не попадают в файл', () => {
  const file = loreFile([elyn, { names: [' Кембэл '], story: ' Любит медовуху. ' }, { names: [''], story: '' }]);
  assert.match(file, /"kind": "sveta-lore"/);
  assert.deepEqual(parseLoreFile(file), [elyn, kembel]);
});

test('файл: подходит и просто массив историй (старая выгрузка), BOM не мешает; чужой файл — null', () => {
  assert.deepEqual(parseLoreFile(`﻿${JSON.stringify([kembel])}`), [kembel]);
  assert.deepEqual(parseLoreFile('[]'), []);
  assert.equal(parseLoreFile('не json'), null);
  assert.equal(parseLoreFile('{"raids": []}'), null);
  assert.equal(parseLoreFile('[{"title": "опрос"}]'), null, 'в файле что-то есть, но не истории');
  assert.deepEqual(parseLoreFile(JSON.stringify([kembel, { names: 'Вася', story: 1 }])), [kembel], 'битые записи пропускаются');
});

test('загрузка ничего не удаляет: новый человек — в конец, совпало хоть одно имя — история обновляется, одинаковые — не считаются', () => {
  const current = [elyn, kembel];
  const incoming = [
    { names: ['нобухидзе'], story: 'Теперь ещё и на лосе.' },
    { names: ['Мыус'], story: 'Роет бункер.' },
    kembel,
  ];
  const { lore, added, updated } = mergeLore(current, incoming);
  assert.equal(added, 1);
  assert.equal(updated, 1);
  assert.deepEqual(
    lore.map((e) => `${e.names.join('/')}: ${e.story}`),
    ['нобухидзе: Теперь ещё и на лосе.', 'Кембэл: Любит медовуху.', 'Мыус: Роет бункер.'],
  );
  assert.deepEqual(current, [elyn, kembel], 'исходный список не меняется — изменения только в черновике');
});
