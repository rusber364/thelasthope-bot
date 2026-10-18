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
  assert.equal(s.raidTemplates[0]?.channelId, '333');
  assert.deepEqual(s.raidTemplates[0]?.slots.map((slot) => slot.raidDay), [4, 5, 1], 'по умолчанию — чт, пт, пн');
  assert.deepEqual(validateSettings(s), []);
});

test('сохранённое побеждает .env, массивы заменяются целиком', () => {
  const next = structuredClone(getSettings());
  next.channels.welcome = null;
  next.logs.voice = { channelId: '444', enabled: false };
  next.raidTemplates = [next.raidTemplates[0]!];
  saveSettings(next);

  resetSettingsCache();
  const s = getSettings();
  assert.equal(s.channels.welcome, null);
  assert.deepEqual(s.logs.voice, { channelId: '444', enabled: false });
  assert.equal(s.raidTemplates.length, 1);
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

test('канала авторизации больше нет: из старых стандартных текстов шаг «пройди {auth}» убирается, свой текст не трогается', () => {
  const old = {
    channels: { welcome: '111', rules: '555', auth: '666' },
    welcome: { text: '{user}, добро пожаловать в **{server}**! Ознакомься с {rules} и пройди {auth}. За любой информацией пиши офицерам!' },
    welcomeDm: { enabled: true, text: 'Что сделать первым делом:\n1. Прочитай {rules}.\n2. Пройди {auth}.\n3. Возьми роль «{role}» кнопкой в {welcome}.' },
    farewell: { channelId: null, text: 'Свой текст с {auth}' },
  };
  db.prepare("UPDATE settings SET value = ? WHERE key = 'bot'").run(JSON.stringify(old));
  resetSettingsCache();
  const s = getSettings();
  assert.deepEqual(s.channels, { welcome: '111', rules: '555' }, 'канал авторизации из старой базы отброшен');
  assert.equal(s.welcome.text, '{user}, добро пожаловать в **{server}**! Ознакомься с {rules}. За любой информацией пиши офицерам!');
  assert.equal(s.welcomeDm.text, 'Что сделать первым делом:\n1. Прочитай {rules}.\n2. Возьми роль «{role}» кнопкой в {welcome}.');
  assert.equal(s.farewell.text, 'Свой текст с {auth}');
  assert.ok(!getSettings().welcome.text.includes('{auth}'));
});

test('валидация ловит неверные значения', () => {
  const s = structuredClone(getSettings());
  s.welcome.text = ' ';
  s.raids.defaultSize = 0;
  s.raids.defaultTime = '25:00';
  const template = { id: 'a', title: 'Рейд', description: '', size: 40, time: '20:00', channelId: null, pingRoleIds: [], slots: [] };
  s.raidTemplates = [
    { ...template, slots: [{ raidDay: 3, raidTime: '20:00', openDay: 2, openTime: '00:00' }, { raidDay: 3, raidTime: '21:00', openDay: 8, openTime: '0:0' }] },
    { ...template, title: 'Рейд 2', size: 0, slots: [{ raidDay: 1, raidTime: '25:00', openDay: 5, openTime: '23:00' }] },
  ];
  const errors = validateSettings(s).join('\n');
  assert.match(errors, /Текст приветствия: не может быть пустым/);
  assert.match(errors, /Размер состава/);
  assert.match(errors, /Время рейда по умолчанию/);
  assert.match(errors, /«Рейд»\), расписание, строка 2: выбери дни рейда и открытия/);
  assert.match(errors, /«Рейд»\), расписание, строка 2: время открытия реги/);
  assert.match(errors, /«Рейд»\): в один день — только один рейд/);
  assert.match(errors, /«Рейд 2»\): повторяется внутренний id/);
  assert.match(errors, /«Рейд 2»\): мест в составе/);
  assert.match(errors, /«Рейд 2»\), расписание, строка 1: время рейда/);
});

test('старые расписания (дни открытия + сдвиг) становятся шаблонами со строками, старые шаблоны — с пустым расписанием', () => {
  const old = {
    raids: {
      defaultSize: 25,
      schedules: [
        { id: 'group1', title: 'Группа 1', channelId: 'R1', days: [1, 4, 5], openAt: '00:00', raidDayOffset: 0, raidTime: '20:00', pingRoleId: 'P' },
        { id: 'late', title: 'Через день', channelId: null, days: [6], openAt: '12:00', raidDayOffset: 2, raidTime: '19:30', pingRoleId: null },
      ],
    },
    raidTemplates: [{ id: 't1', title: 'Огненные Недра', description: 'Сбор в 19:45', size: 40, time: '20:00', channelId: 'C', pingRoleId: 'P2' }],
  };
  db.prepare("UPDATE settings SET value = ? WHERE key = 'bot'").run(JSON.stringify(old));
  resetSettingsCache();
  const s = getSettings();
  assert.deepEqual(
    s.raidTemplates.map((t) => t.id),
    ['t1', 'group1', 'late'],
  );
  const [manual, group, late] = s.raidTemplates;
  assert.deepEqual(manual, { id: 't1', title: 'Огненные Недра', description: 'Сбор в 19:45', size: 40, time: '20:00', channelId: 'C', pingRoleIds: ['P2'], slots: [] });
  assert.deepEqual(group, {
    id: 'group1',
    title: 'Группа 1',
    description: '',
    size: 25,
    time: '20:00',
    channelId: 'R1',
    pingRoleIds: ['P'],
    slots: [1, 4, 5].map((day) => ({ raidDay: day, raidTime: '20:00', openDay: day, openTime: '00:00' })),
  });
  assert.deepEqual(late!.slots, [{ raidDay: 1, raidTime: '19:30', openDay: 6, openTime: '12:00' }], 'суббота + 2 дня = понедельник');
  assert.ok(!('schedules' in s.raids));
  assert.deepEqual(validateSettings(s), []);
});
