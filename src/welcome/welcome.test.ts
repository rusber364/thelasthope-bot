import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GuildMember } from 'discord.js';

process.env.BOT_DB_PATH = ':memory:';
const { buildWelcome } = await import('./welcome.ts');
const { getSettings, saveSettings } = await import('../botSettings.ts');
const { closePoll, createPoll } = await import('../polls/store.ts');

// Подставной новичок на сервере G с ролью «Гость» и каналом правил.
const guild = { id: 'G', name: 'The Last Hope', roles: { cache: new Map([['R', { id: 'R', name: 'Гость' }]]) } };
const member = {
  id: '7',
  guild,
  displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
  toString: () => '<@7>',
} as unknown as GuildMember;

const definition = { title: 'Анкета', description: '', anonymous: false, button: 'Пройти', blocks: [] };
const survey = createPoll('G', 'W', definition, 'officer');
const otherServer = createPoll('X', 'W', definition, 'officer');

const s = structuredClone(getSettings());
s.channels = { welcome: 'W', rules: 'RU', auth: null };
s.roles = { guest: 'R', autorole: null };
saveSettings(s);

/** Кнопки и тексты карточки приветствия в виде, который уходит в Discord. */
function render(guestTaken = false) {
  const card = buildWelcome(member, guestTaken).components![0] as unknown as { toJSON(): { components: Record<string, unknown>[] } };
  const parts = card.toJSON().components;
  const buttons = parts.flatMap((part) => (part.type === 1 ? (part.components as { custom_id?: string; label: string; url?: string }[]) : []));
  const texts = parts.flatMap((part) => (part.type === 10 ? [part.content as string] : []));
  return { buttons, texts };
}

const useSurvey = (pollId: number | null) => {
  const next = structuredClone(getSettings());
  next.onboarding = { ...next.onboarding, pollId, offer: 'Расскажи о себе, {user}', button: 'Пройти анкету' };
  saveSettings(next);
};

test('анкета не выбрана — в приветствии только «Гость» и «Правила»', () => {
  useSurvey(null);
  const { buttons } = render();
  assert.deepEqual(
    buttons.map((b) => b.label),
    ['Получить роль «Гость»', 'Правила'],
  );
});

test('выбрана открытая анкета — строка с подстановками и кнопка poll:start, в том числе после «Получить роль»', () => {
  useSurvey(survey.id);
  for (const guestTaken of [false, true]) {
    const { buttons, texts } = render(guestTaken);
    assert.ok(texts.includes('Расскажи о себе, <@7>'));
    const button = buttons.find((b) => b.label === 'Пройти анкету');
    assert.equal(button?.custom_id, `poll:start:${survey.id}`);
  }
});

test('анкета закрыта, удалена или с другого сервера — кнопки нет, приветствие не ломается', () => {
  useSurvey(otherServer.id);
  assert.ok(!render().buttons.some((b) => b.label === 'Пройти анкету'));
  useSurvey(9999);
  assert.ok(!render().buttons.some((b) => b.label === 'Пройти анкету'));
  closePoll(survey.id);
  useSurvey(survey.id);
  const { buttons, texts } = render();
  assert.ok(!buttons.some((b) => b.label === 'Пройти анкету'));
  assert.ok(!texts.some((t) => t.startsWith('Расскажи о себе')));
});
