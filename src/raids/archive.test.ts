import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.BOT_DB_PATH = ':memory:';
const { archiveRaids, raidSummary } = await import('./archive.ts');
const { attendanceCounts, createRaid, getRaid, getSignups, saveAttendance, setRaidMessage, setRaidStatus, upsertSignup } = await import('./store.ts');
const { getSettings, saveSettings } = await import('../botSettings.ts');

const HOUR = 60 * 60 * 1000;
type Sent = { embeds: { toJSON(): { title?: string; description?: string } }[] };

// Подставные каналы: канал рег «c» и канал-архив «A».
const sentTo: Record<string, { title?: string; description?: string }[][]> = { c: [], A: [] };
const deleted: string[] = [];
const channel = (id: string) => ({
  isTextBased: () => true,
  isDMBased: () => false,
  send: async (payload: Sent) => void sentTo[id]!.push(payload.embeds.map((e) => e.toJSON())),
  messages: { delete: async (messageId: string) => void deleted.push(messageId) },
});
const client = { channels: { fetch: async (id: string) => (id in sentTo ? channel(id) : null) } };

function raidWithRoster(title: string, startedHoursAgo: number, messageId: string) {
  const raid = createRaid({ guildId: 'g', channelId: 'c', title, startsAt: Date.now() - startedHoursAgo * HOUR, size: 2, createdBy: 'u' });
  setRaidMessage(raid.id, messageId);
  upsertSignup(raid.id, 'a', 'warrior_prot', 'Танк');
  upsertSignup(raid.id, 'b', 'priest_holy', 'Хил');
  upsertSignup(raid.id, 'c', 'mage_fire', 'Маг'); // третий при размере 2 — в запасе
  return getRaid(raid.id)!;
}

function setArchive(mode: 'off' | 'move' | 'delete') {
  const s = structuredClone(getSettings());
  s.raids.archive = { mode, channelId: 'A', hours: 6 };
  saveSettings(s);
}

test('итог: состав по ролям, запас, посещаемость, статус', () => {
  const raid = raidWithRoster('Итоговый', 10, 'm0');
  saveAttendance(raid.id, [{ userId: 'a', status: 'present' }, { userId: 'b', status: 'absent' }]);
  const json = raidSummary(raid, getSignups(raid.id), attendanceCounts(raid.id)).toJSON();
  assert.equal(json.title, 'Итог: Итоговый');
  assert.match(json.description ?? '', /Статус:\*\* проведён/);
  assert.match(json.description ?? '', /Состав:\*\* 2\/2 — Танки 1 · Ближний бой 0 · Дальний бой 0 · Лекари 1/);
  assert.match(json.description ?? '', /Запас:\*\* 1/);
  assert.match(json.description ?? '', /пришли 1, не пришли 1/);
});

test('режим «перенос»: итог и состав в архиве, рега удалена, повторно не архивируется', async () => {
  setArchive('move');
  const old = raidWithRoster('Огненные Недра', 7, 'm1');
  const fresh = raidWithRoster('Свежая', 1, 'm2'); // срок 6 ч ещё не прошёл
  await archiveRaids(client as never);

  const moved = sentTo.A!.find((embeds) => embeds[0]?.title === 'Итог: Огненные Недра');
  assert.ok(moved, 'итог в канале-архиве');
  assert.equal(moved!.length, 2, 'итог + финальный состав');
  assert.ok(deleted.includes('m1'), 'рега удалена из канала рег');
  assert.ok(!deleted.includes('m2'), 'свежая рега на месте');
  assert.equal(getRaid(old.id)!.messageId, null);
  assert.equal(getRaid(fresh.id)!.messageId, 'm2');

  const before = sentTo.A!.length;
  await archiveRaids(client as never);
  assert.equal(sentTo.A!.length, before, 'повторный тик ничего не дублирует');
});

test('режим «удаление»: в канале реги остаётся только итог; отменённые тоже убираются', async () => {
  setArchive('delete');
  const cancelled = raidWithRoster('Отменённый', 8, 'm3');
  setRaidStatus(cancelled.id, 'cancelled');
  await archiveRaids(client as never);
  const summary = sentTo.c!.find((embeds) => embeds[0]?.title === 'Итог: Отменённый');
  assert.ok(summary);
  assert.match(summary![0]!.description ?? '', /отменён/);
  assert.ok(deleted.includes('m3'));
});

test('режим «выключено» ничего не трогает', async () => {
  setArchive('off');
  raidWithRoster('Не трогать', 30, 'm4');
  await archiveRaids(client as never);
  assert.ok(!deleted.includes('m4'));
});
