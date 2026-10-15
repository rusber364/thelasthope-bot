// Иконки классов, спеков и оформления реги — родные иконки WoW (с wowhead), загруженные как «эмодзи приложения».
// Бот сам загружает недостающие при запуске, поэтому делать ничего не нужно. Такие эмодзи
// работают на любом сервере, где есть бот, и даже в личных сообщениях.
import type { APIMessageComponentEmoji, Client } from 'discord.js';
import { CLASSES, SPECS, emojiName, type WowClass, type WowSpec } from './classes.ts';

/** Иконки оформления реги: роли, шапка, кнопки. Ключ → имя иконки на wowhead. */
export const UI_ICONS = {
  tank: 'inv_shield_06',
  healer: 'spell_holy_flashheal',
  melee: 'inv_sword_04',
  ranged: 'inv_weapon_bow_07',
  tentative: 'inv_misc_questionmark',
  bench: 'spell_nature_sleep',
  leader: 'inv_misc_tournaments_banner_human',
  date: 'inv_misc_note_06',
  time: 'inv_misc_pocketwatch_01',
  countdown: 'spell_holy_borrowedtime',
  signups: 'inv_misc_groupneedmore',
  leave: 'spell_chargenegative',
} as const;

export type UiIcon = keyof typeof UI_ICONS;

/** Обычные эмодзи — только на случай, если иконку не удалось загрузить. */
const UI_FALLBACK: Record<UiIcon, string> = {
  tank: '🛡️',
  healer: '💚',
  melee: '⚔️',
  ranged: '🏹',
  tentative: '❔',
  bench: '🪑',
  leader: '🚩',
  date: '📅',
  time: '🕗',
  countdown: '⏳',
  signups: '👥',
  leave: '✖️',
};

const loaded = new Map<string, { id: string; name: string }>();

const iconUrl = (icon: string) => `https://wow.zamimg.com/images/wow/icons/large/${icon}.jpg`;

const ALL_ICONS = [
  ...CLASSES,
  ...SPECS,
  ...Object.entries(UI_ICONS).map(([key, icon]) => ({ id: `ui_${key}`, icon })),
];

/** Загружает список эмодзи бота и докачивает родные иконки, которых ещё нет. */
export async function ensureAppEmojis(client: Client<true>): Promise<void> {
  try {
    const existing = await client.application.emojis.fetch();
    for (const emoji of existing.values()) {
      if (emoji.name) loaded.set(emoji.name, { id: emoji.id, name: emoji.name });
    }

    const missing = ALL_ICONS.filter(({ id }) => !loaded.has(emojiName(id)));
    if (missing.length) console.log(`🎨 Загружаю иконки WoW: ${missing.length}…`);

    let failed = 0;
    for (const { id, icon } of missing) {
      try {
        const response = await fetch(iconUrl(icon));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const emoji = await client.application.emojis.create({
          attachment: Buffer.from(await response.arrayBuffer()),
          name: emojiName(id),
        });
        loaded.set(emojiName(id), { id: emoji.id, name: emojiName(id) });
      } catch (error) {
        failed++;
        console.error(`Не удалось загрузить иконку ${icon}:`, error instanceof Error ? error.message : error);
      }
    }

    const total = ALL_ICONS.length;
    console.log(`🎨 Иконки WoW: ${total - failed}/${total}${failed ? ' — недостающие попробую загрузить при следующем запуске' : ''}`);
  } catch (error) {
    console.error('Не удалось получить эмодзи приложения:', error);
  }
}

function asText(id: string): string | undefined {
  const emoji = loaded.get(emojiName(id));
  return emoji ? `<:${emoji.name}:${emoji.id}>` : undefined;
}

/** Иконка оформления для текста: `<:wf_ui_tank:123…>`. */
export function uiEmoji(key: UiIcon): string {
  return asText(`ui_${key}`) ?? UI_FALLBACK[key];
}

/** Иконка оформления для кнопок и пунктов меню. */
export function uiComponentEmoji(key: UiIcon): APIMessageComponentEmoji {
  return loaded.get(emojiName(`ui_${key}`)) ?? { name: UI_FALLBACK[key] };
}

/** Иконка класса для текста. Если иконки нет — пустая строка, без заглушек. */
export function classEmoji(wowClass: WowClass): string {
  return asText(wowClass.id) ?? '';
}

/** Иконка класса для пунктов меню. undefined — пункт будет без картинки. */
export function classComponentEmoji(wowClass: WowClass): APIMessageComponentEmoji | undefined {
  return loaded.get(emojiName(wowClass.id));
}

/** Иконка спека для текста. Пока её нет — иконка роли. */
export function specEmoji(spec: WowSpec): string {
  return asText(spec.id) ?? uiEmoji(spec.role);
}

export function specComponentEmoji(spec: WowSpec): APIMessageComponentEmoji {
  return loaded.get(emojiName(spec.id)) ?? uiComponentEmoji(spec.role);
}
