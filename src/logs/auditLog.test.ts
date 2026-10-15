import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuditLogEvent } from 'discord.js';
import { formatAuditEntry, type AuditEntryLike } from './auditLog.ts';

const BOT = '900';
const entry = (over: Partial<AuditEntryLike>): AuditEntryLike => ({
  action: AuditLogEvent.MemberKick,
  executorId: '100',
  targetId: '200',
  reason: null,
  changes: [],
  ...over,
});
const text = (result: ReturnType<typeof formatAuditEntry>) => {
  const json = result?.embed.toJSON();
  return `${json?.title}\n${json?.description}`;
};

test('ручной кик → лог-модерация, с исполнителем и причиной', () => {
  const result = formatAuditEntry(entry({ reason: 'Флуд' }), BOT);
  assert.equal(result?.category, 'moderation');
  assert.match(text(result), /Кик/);
  assert.match(text(result), /\*\*Кто:\*\* <@100>/);
  assert.match(text(result), /<@200>/);
  assert.match(text(result), /Причина:\*\* Флуд/);
});

test('тайм-аут и его снятие → лог-модерация', () => {
  const set = formatAuditEntry(
    entry({ action: AuditLogEvent.MemberUpdate, changes: [{ key: 'communication_disabled_until', new: '2026-10-20T20:00:00.000Z' }] }),
    BOT,
  );
  assert.equal(set?.category, 'moderation');
  assert.match(text(set), /Тайм-аут/);
  assert.match(text(set), /<t:\d+:f>/);

  const removed = formatAuditEntry(
    entry({ action: AuditLogEvent.MemberUpdate, changes: [{ key: 'communication_disabled_until', old: '2026-10-20T20:00:00.000Z' }] }),
    BOT,
  );
  assert.match(text(removed), /Снят тайм-аут/);
});

test('смена ника и ролей → лог-сервер', () => {
  const nick = formatAuditEntry(entry({ action: AuditLogEvent.MemberUpdate, changes: [{ key: 'nick', old: 'Old', new: 'New' }] }), BOT);
  assert.equal(nick?.category, 'server');
  assert.match(text(nick), /Ник:\*\* Old → New/);

  const roles = formatAuditEntry(
    entry({ action: AuditLogEvent.MemberRoleUpdate, changes: [{ key: '$add', new: [{ id: '777', name: 'Рейдер' }] }] }),
    BOT,
  );
  assert.equal(roles?.category, 'server');
  assert.match(text(roles), /Добавлены:\*\* <@&777>/);
});

test('изменение роли показывает изменения, права — без битовой маски', () => {
  const result = formatAuditEntry(
    entry({
      action: AuditLogEvent.RoleUpdate,
      changes: [
        { key: 'name', old: 'Гость', new: 'Гости' },
        { key: 'color', old: 0, new: 0xc69b3a },
        { key: 'permissions', old: '0', new: '8' },
      ],
    }),
    BOT,
  );
  assert.equal(result?.category, 'server');
  const t = text(result);
  assert.match(t, /Название:\*\* Гость → Гости/);
  assert.match(t, /Цвет:\*\* #000000 → #c69b3a/);
  assert.match(t, /Права:\*\* изменены/);
});

test('удалённый канал называется по имени', () => {
  const result = formatAuditEntry(entry({ action: AuditLogEvent.ChannelDelete, changes: [{ key: 'name', old: 'флуд' }] }), BOT);
  assert.match(text(result), /Удалён канал/);
  assert.match(text(result), /#флуд/);
});

test('действия самого бота и неизвестные записи пропускаются', () => {
  assert.equal(formatAuditEntry(entry({ executorId: BOT }), BOT), null);
  assert.equal(formatAuditEntry(entry({ executorId: null }), BOT), null);
  assert.equal(formatAuditEntry(entry({ action: AuditLogEvent.StickerCreate }), BOT), null);
});
