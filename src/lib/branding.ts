// Оформление бота: аватар и баннер профиля из картинок проекта.
// Аватар: assets/bot-avatar.* или logo.jpg. Баннер: assets/bot-banner.* или logo.jpg
// (Discord сам обрежет квадратную картинку под баннер; для красоты положи широкую 680×240).
import { existsSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Routes, type APIUser, type REST } from 'discord.js';

export type BrandingPart = 'avatar' | 'banner';

const EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const LOGO = fileURLToPath(new URL('../../logo.jpg', import.meta.url));

/** Какой файл будет использован для аватара или баннера. null — картинки нет. */
export function brandingFile(part: BrandingPart): string | null {
  for (const ext of EXTENSIONS) {
    const path = fileURLToPath(new URL(`../../assets/bot-${part}${ext}`, import.meta.url));
    if (existsSync(path)) return path;
  }
  return existsSync(LOGO) ? LOGO : null;
}

function dataUri(path: string): string {
  const mime = MIME[extname(path).toLowerCase()] ?? 'image/png';
  return `data:${mime};base64,${readFileSync(path).toString('base64')}`;
}

/**
 * Загружает картинку в профиль бота (PATCH /users/@me). Возвращает обновлённого пользователя.
 * Discord ограничивает частоту смены аватара — при слишком частых попытках вернётся ошибка.
 */
export async function applyBranding(rest: REST, part: BrandingPart): Promise<APIUser> {
  const file = brandingFile(part);
  if (!file) throw new Error(`Нет картинки для «${part}»: положи logo.jpg в корень проекта или assets/bot-${part}.png.`);
  return (await rest.patch(Routes.user(), { body: { [part]: dataUri(file) } })) as APIUser;
}

/** Понятное объяснение ошибки Discord при смене аватара или баннера. */
export function brandingError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/too fast|rate/i.test(message)) return 'Discord не разрешает менять аватар или баннер так часто — попробуй через несколько минут.';
  return `Discord не принял картинку: ${message}`;
}
