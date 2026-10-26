// Мат от тех, кому админы разрешили ругаться везде (страница «Фильтр мата»): фильтр их не трогает, зато Света ворчит —
// и за мат, и за то, что админы дали такое право. Ворчит моделью в духе характера, а без модели — заготовкой.
import type { ProfanitySettings } from '../botSettings.ts';
import { findProfanity } from '../lib/profanity.ts';

/** Есть ли за что поворчать: автор в списке, фильтр включён, канал не из исключений (там мат можно всем), мат найден. */
export function swearsWithPermission(profanity: ProfanitySettings, userId: string, channelId: string, content: string): boolean {
  return (
    profanity.enabled &&
    profanity.allowedUserIds.includes(userId) &&
    !profanity.ignoredChannelIds.includes(channelId) &&
    findProfanity(content, profanity.extraWords, profanity.level) !== null
  );
}

/** Пауза между ворчаниями на одного человека — чтобы не превращать каждый мат в перепалку. */
export class ScoldTimer {
  private readonly last = new Map<string, number>();

  due(key: string, now: number, minutes: number): boolean {
    return now - (this.last.get(key) ?? -Infinity) >= minutes * 60_000;
  }

  record(key: string, now: number): void {
    this.last.set(key, now);
  }
}

/** Заготовки — когда модель недоступна или упёрлась в лимиты. Без рода: пол игрока Света не знает. */
export const SCOLD_LINES = [
  'Опять мат 🙄 Админы тебе это разрешили, а уши вянут у меня.',
  'Кто вообще дал тебе право так выражаться? Ах да, админы… С ними я ещё поговорю 😤',
  'Фильтр тебе не указ, а я — указ. Язык попроще, пожалуйста 😒',
  'Мат — не аргумент, даже с разрешения админов 😏',
];

/** Заготовка по случайному числу 0…1. */
export function scoldLine(roll: number): string {
  return SCOLD_LINES[Math.min(SCOLD_LINES.length - 1, Math.floor(roll * SCOLD_LINES.length))]!;
}
