import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.BOT_DB_PATH = ':memory:';
const { checkProfanity } = await import('./profanityFilter.ts');
const { getSettings, saveSettings } = await import('../botSettings.ts');

// Подставной сервер: канал инцидентов собирает карточки модераторам.
const cards: unknown[] = [];
const incidents = { isSendable: () => true, send: async (payload: unknown) => void cards.push(payload) };
const guild = { id: 'G', channels: { cache: new Map([['INC', incidents]]) }, members: { fetch: async () => null } };

function configure(patch: Partial<ReturnType<typeof getSettings>['profanity']>) {
  const s = structuredClone(getSettings());
  s.alerts.incidentChannelId = 'INC';
  s.profanity = { ...s.profanity, enabled: true, level: 'rude', action: 'delete', warningSeconds: 0, ignoredChannelIds: [], allowedUserIds: [], extraWords: [], ...patch };
  saveSettings(s);
  cards.length = 0;
}

function message(content: string, { userId = 'u1', channelId = 'C' } = {}) {
  const log = { deleted: false, warned: 0, mutedFor: 0 };
  const author = { id: userId, bot: false, tag: 'tester', createdTimestamp: 0, toString: () => `<@${userId}>` };
  const msg = {
    id: `m${Math.random()}`,
    partial: false,
    system: false,
    content,
    channelId,
    url: `https://discord.com/channels/G/${channelId}/1`,
    inGuild: () => true,
    guild,
    guildId: 'G',
    author,
    client: { user: { tag: 'bot', toString: () => '<@bot>' } },
    channel: { toString: () => `<#${channelId}>`, send: async () => void log.warned++ },
    member: { moderatable: true, timeout: async (ms: number) => void (log.mutedFor = ms) },
    delete: async () => void (log.deleted = true),
  };
  return { msg: msg as never, log };
}

test('выключен или канал-исключение — ничего; без мата — ничего', async () => {
  configure({ enabled: false });
  const off = message('ну ты и сука');
  assert.equal(await checkProfanity(off.msg), 'none');
  assert.equal(off.log.deleted, false);

  configure({ ignoredChannelIds: ['FLOOD'] });
  assert.equal(await checkProfanity(message('ну ты и сука', { channelId: 'FLOOD' }).msg), 'none');
  assert.equal(await checkProfanity(message('всем привет, идём в рейд').msg), 'none');
  assert.equal(cards.length, 0);
});

test('кому мат разрешён — того фильтр не трогает: не удаляет, не мутит, карточек нет; остальных ловит как обычно', async () => {
  configure({ action: 'mute', strikesToMute: 1, allowedUserIds: ['ALLOWED'] });
  const allowed = message('да ну нахуй', { userId: 'ALLOWED' });
  assert.equal(await checkProfanity(allowed.msg), 'none');
  assert.deepEqual([allowed.log.deleted, allowed.log.mutedFor, cards.length], [false, 0, 0]);
  assert.equal(await checkProfanity(message('да ну нахуй', { userId: 'u9' }).msg), 'muted');
});

test('уровень «только мат»: «сука» и «мудак» пропускаются, мат ловится; свои слова — на любом уровне', async () => {
  configure({ level: 'mat', extraWords: ['дурак'] });
  assert.equal(await checkProfanity(message('ну ты и сука').msg), 'none');
  assert.equal(await checkProfanity(message('мудак').msg), 'none');
  assert.equal(await checkProfanity(message('да ну нахуй').msg), 'deleted');
  assert.equal(await checkProfanity(message('сам дураки').msg), 'deleted');
});

test('«только сообщить»: сообщение остаётся, модераторам — карточка со ссылкой', async () => {
  configure({ action: 'report' });
  const { msg, log } = message('ну ты и сука');
  assert.equal(await checkProfanity(msg), 'reported');
  assert.equal(log.deleted, false);
  assert.equal(log.warned, 0);
  assert.equal(cards.length, 1);
  assert.match(JSON.stringify(cards[0]), /не удалено.*https:\/\/discord\.com\/channels\/G\/C\/1/);
});

test('«удалить»: удаляет, предупреждает (если включено), карточка модераторам, без мута', async () => {
  configure({ action: 'delete', warningSeconds: 1 });
  for (let i = 0; i < 4; i++) {
    const { msg, log } = message('блять', { userId: 'u2' });
    assert.equal(await checkProfanity(msg), 'deleted');
    assert.deepEqual([log.deleted, log.warned, log.mutedFor], [true, 1, 0]);
  }
  assert.equal(cards.length, 4);
});

test('«удалить и мутить»: мут на третье нарушение за окно, длительность из настроек', async () => {
  configure({ action: 'mute', strikesToMute: 3, strikeWindowMinutes: 10, muteMinutes: 15 });
  const outcomes: string[] = [];
  let mutedFor = 0;
  for (let i = 0; i < 3; i++) {
    const { msg, log } = message('пиздец', { userId: 'u3' });
    outcomes.push(await checkProfanity(msg));
    mutedFor = log.mutedFor;
  }
  assert.deepEqual(outcomes, ['deleted', 'deleted', 'muted']);
  assert.equal(mutedFor, 15 * 60_000);
});
