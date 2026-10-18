import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.BOT_DB_PATH = ':memory:';
const { raidActionEntry } = await import('./actionLog.ts');
const { buildBoard } = await import('./board.ts');
const { buildRaidCreateMessage, buildRaidMessage } = await import('./render.ts');
const { sendReminders } = await import('./scheduler.ts');
const { createRaid, getRaid, setRaidStatus, upsertSignup } = await import('./store.ts');

const signup = { raidId: 1, userId: 'u1', specId: 'mage_fire', displayName: 'Морозко', tentative: false, reserve: false, createdAt: 1 };
const dungeon = (title = 'Мёртвые копи', inMs = 30 * 60_000) =>
  createRaid({ guildId: 'g', channelId: 'c', title, startsAt: Date.now() + inMs, size: 5, createdBy: 'u', kind: 'dungeon', limits: { tank: 1, healer: 1, dps: 3 } });

test('лог-рейдов: запись и отписка называют вид сбора', () => {
  assert.equal(raidActionEntry(null, signup)?.title, 'Запись на рейд', 'у рейдов — как раньше');
  assert.equal(raidActionEntry(null, signup, 'dungeon')?.title, 'Запись в подземелье');
  assert.equal(raidActionEntry(signup, null, 'pvp')?.title, 'Отписка из PvP-группы');
});

test('рега подземелья: упоминание при открытии, строка состава, отмена без слов с родом', () => {
  const raid = dungeon();
  const created = buildRaidCreateMessage(raid, [], ['R']);
  assert.equal('content' in created ? created.content : null, '<@&R> открыта запись в подземелье!');

  setRaidStatus(raid.id, 'cancelled');
  const embed = buildRaidMessage(getRaid(raid.id)!, []).embeds.at(-1)!.toJSON();
  assert.match(embed.description ?? '', /\*\*Подземелье\*\* · 5 мест · 1 танк, 1 лекарь, 3 бойца/);
  assert.match(embed.description ?? '', /\*\*Отменили\.\*\*/);
  assert.doesNotMatch(embed.description ?? '', /отменён|Рейд/);
  assert.ok(embed.fields?.some((f) => f.name.includes('Танки') && f.name.includes('(0/1)')));
});

test('напоминание в личку и «Ближайшие сборы» называют вид', async () => {
  const dms: string[] = [];
  const client = { users: { fetch: async () => ({ send: async (text: string) => void dms.push(text) }) } };
  const raid = dungeon('Ульдаман');
  upsertSignup(raid.id, 'u1', 'mage_fire', 'Морозко');
  await sendReminders(client as never);
  assert.match(dms[0] ?? '', /\*\*Напоминание:\*\* подземелье \*\*Ульдаман\*\* начнётся/);

  const board = buildBoard([{ raid: { ...getRaid(raid.id)!, messageId: 'm' }, signed: 1, tentative: 0 }]).toJSON();
  assert.match(board.title ?? '', /Ближайшие сборы/);
  assert.match(board.description ?? '', /\*\*\[Ульдаман\]\(.+\)\*\* · Подземелье/);
});
