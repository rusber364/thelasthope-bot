import assert from 'node:assert/strict';
import { test } from 'node:test';

// База в памяти и ID «из .env» — до импорта модулей, которые их читают.
process.env.BOT_DB_PATH = ':memory:';
process.env.WELCOME_CHANNEL_ID = '111';
process.env.MOD_LOG_CHANNEL_ID = '222';
process.env.RAID_CHANNEL_1_ID = '333';

const { getSettings, saveSettings, resetSettingsCache, validateSettings } = await import('./botSettings.ts');
const { db } = await import('./db.ts');

test('без сохранённых настроек — умолчания и ID из .env', () => {
  const s = getSettings();
  assert.equal(s.channels.welcome, '111');
  assert.equal(s.channels.rules, null);
  assert.equal(s.logs.moderation.channelId, '222');
  assert.equal(s.logs.voice.enabled, true);
  assert.equal(s.raids.schedules[0]?.channelId, '333');
  assert.deepEqual(validateSettings(s), []);
});

test('сохранённое побеждает .env, массивы заменяются целиком', () => {
  const next = structuredClone(getSettings());
  next.channels.welcome = null;
  next.logs.voice = { channelId: '444', enabled: false };
  next.raids.schedules = [next.raids.schedules[0]!];
  saveSettings(next);

  resetSettingsCache();
  const s = getSettings();
  assert.equal(s.channels.welcome, null);
  assert.deepEqual(s.logs.voice, { channelId: '444', enabled: false });
  assert.equal(s.raids.schedules.length, 1);
});

test('новые поля, которых нет в старой сохранённой версии, берутся из умолчаний', () => {
  db.prepare("UPDATE settings SET value = ? WHERE key = 'bot'").run(JSON.stringify({ channels: { rules: '555' } }));
  resetSettingsCache();
  const s = getSettings();
  assert.equal(s.channels.rules, '555');
  assert.equal(s.channels.welcome, '111');
  assert.equal(s.logs.members.enabled, true);
  assert.equal(s.raids.defaultSize, 40);
});

test('валидация ловит неверные значения', () => {
  const s = structuredClone(getSettings());
  s.welcome.text = ' ';
  s.raids.defaultSize = 0;
  s.raids.defaultTime = '25:00';
  s.raids.schedules = [
    { id: 'a', title: 'Рейд', channelId: null, days: [], openAt: '00:00', raidDayOffset: 0, raidTime: '20:00', pingRoleId: null },
    { id: 'a', title: 'Рейд 2', channelId: null, days: [8], openAt: '0:0', raidDayOffset: 30, raidTime: '20:00', pingRoleId: null },
  ];
  const errors = validateSettings(s).join('\n');
  assert.match(errors, /Текст приветствия: не может быть пустым/);
  assert.match(errors, /Размер состава/);
  assert.match(errors, /Время рейда по умолчанию/);
  assert.match(errors, /Расписание 1.*хотя бы один день/);
  assert.match(errors, /Расписание 2.*повторяется внутренний id/);
  assert.match(errors, /Расписание 2.*время открытия/);
  assert.match(errors, /Расписание 2.*сдвиг дня/);
});
