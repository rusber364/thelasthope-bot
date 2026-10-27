// Залить в память Светы заранее собранное: `pnpm sveta:import <файл.json>` (формат — sveta/episodes.ts::MemoryImport).
// Можно при работающем боте; повторный запуск ничего не удвоит.
import { readFileSync } from 'node:fs';
import { importErrors, importMemory, type MemoryImport } from '../sveta/episodes.ts';

const file = process.argv[2];
if (!file) {
  console.error('Укажи файл: pnpm sveta:import <файл.json>');
  process.exit(1);
}
const data = JSON.parse(readFileSync(file, 'utf8')) as MemoryImport;
const errors = importErrors(data);
if (errors.length) {
  console.error(`❌ Файл не подходит:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
const result = importMemory(data, Date.now());
console.log(`🧠 В память Светы: новых заметок — ${result.notes}, разговоров — ${result.episodes}, о себе — ${result.self}.`);
