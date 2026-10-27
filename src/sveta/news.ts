// Новости о сборах от Светы: открылась рега, «Сбор!», перенос, отмена. Заготовленные фразы со случайным выбором —
// без запросов к Gemini, бесплатный лимит остаётся на живые разговоры. Пишет в канал новостей из админки.
import { TimestampStyles, time } from 'discord.js';
import { getSettings } from '../botSettings.ts';
import { KINDS } from '../raids/kinds.ts';
import type { Raid } from '../raids/store.ts';
import { svetaChannel } from './index.ts';
import { moodFromRaid } from './mood.ts';
import { raidLink } from './tools.ts';

export type RaidNews = 'open' | 'gather' | 'move' | 'cancel';

type Phrase = (p: { kind: string; word: string; title: string; when: string; soon: string; link: string }) => string;

const PHRASES: Record<RaidNews, Phrase[]> = {
  open: [
    (p) => `📯 Открылась рега: ${p.kind} **${p.title}** — ${p.when}. Записывайтесь, пока танки не разобрали места!${p.link}`,
    (p) => `Новая рега! ${p.kind} **${p.title}**, ${p.when}. Кто не запишется — тот моет котлы в таверне 😏${p.link}`,
    (p) => `Эй, Азерот! ${p.kind} **${p.title}** — ${p.when}. Кнопки записи уже ждут 🍺${p.link}`,
  ],
  gather: [
    (p) => `⏰ ${p.kind} **${p.title}** начнётся ${p.soon}! Кто опоздает — тот хилит 😈${p.link}`,
    (p) => `Сбор! ${p.kind} **${p.title}** ${p.soon}. Эль допиваем, баффы берём 🍺${p.link}`,
  ],
  move: [
    (p) => `🗓️ ${p.kind} **${p.title}** перенесли: теперь ${p.when}. Запомните, а я напомню 😉${p.link}`,
    (p) => `Планы поменялись: ${p.word} **${p.title}** теперь ${p.when}.${p.link}`,
  ],
  cancel: [
    (p) => `${p.kind} **${p.title}** (${p.when}) отменили 😔 Ну хоть эль останется.`,
    (p) => `Отбой: ${p.word} **${p.title}** не состоится. Свободный вечер — отличный повод пофармить 🎣`,
  ],
};

/** Текст новости (чистая функция). roll — случайное число 0…1, выбирает фразу. */
export function newsText(news: RaidNews, raid: Raid, roll: number): string {
  const start = new Date(raid.startsAt);
  const link = raidLink(raid);
  const phrases = PHRASES[news];
  const phrase = phrases[Math.min(phrases.length - 1, Math.floor(roll * phrases.length))]!;
  return phrase({
    kind: KINDS[raid.kind].title,
    word: KINDS[raid.kind].word,
    title: raid.title,
    when: time(start, TimestampStyles.FullDateShortTime),
    soon: time(start, TimestampStyles.RelativeTime),
    link: link && news !== 'cancel' ? ` ${link}` : '',
  });
}

/** Рассказать о сборе в канале новостей Светы. Ошибки не мешают самим регам — только пишутся в лог. */
export async function announceRaid(news: RaidNews, raid: Raid, roll = Math.random()): Promise<void> {
  const { enabled, newsChannelId } = getSettings().sveta;
  if (!enabled) return;
  // Сборы влияют на её настроение, даже если канала новостей нет.
  moodFromRaid(raid.guildId, Date.now(), news);
  if (!newsChannelId) return;
  const channel = svetaChannel(newsChannelId);
  if (!channel) return;
  try {
    await channel.send({ content: newsText(news, raid, roll), allowedMentions: { parse: [] } });
  } catch (error) {
    console.error(`🤖 Света: не удалось рассказать о реге #${raid.id}:`, error);
  }
}
