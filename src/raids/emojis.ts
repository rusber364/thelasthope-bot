// Иконки классов, спеков и оформления реги — родные иконки WoW (с wowhead и из файлов игры), загруженные как «эмодзи приложения».
// Бот сам загружает недостающие при запуске, поэтому делать ничего не нужно. Такие эмодзи
// работают на любом сервере, где есть бот, и даже в личных сообщениях.
import { readFile } from 'node:fs/promises';
import type { APIMessageComponentEmoji, Client } from 'discord.js';
import { CLASSES, SPECS, emojiName, type WowClass, type WowSpec } from './classes.ts';

/**
 * Иконки оформления реги: роли, шапка, кнопки. Ключ → имя иконки на wowhead
 * или { file } — картинка из assets/role-icons (круглые значки ролей из окна поиска группы в игре).
 * Эмодзи из файла называется по файлу (wf_lfg_tank): чтобы заменить картинку, положи файл с новым именем
 * и поменяй его здесь — бот загрузит новую, старая останется в эмодзи приложения и не помешает.
 */
export const UI_ICONS = {
  tank: { file: 'tank.png' },
  healer: { file: 'healer.png' },
  melee: { file: 'dps.png' },
  ranged: 'inv_weapon_bow_07',
  tentative: 'inv_misc_questionmark',
  bench: 'spell_nature_sleep',
  leader: { file: 'leader.png' },
  date: 'inv_misc_note_06',
  time: 'inv_misc_pocketwatch_01',
  countdown: 'spell_holy_borrowedtime',
  signups: 'inv_misc_groupneedmore',
  leave: 'spell_chargenegative',
} as const satisfies Record<string, string | { file: string }>;

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

/** Откуда брать картинку: icon — с wowhead, file — из assets/role-icons. */
interface IconSource {
  id: string;
  icon?: string;
  file?: string;
}

/** id эмодзи оформления: wf_ui_bench для иконок с wowhead, wf_lfg_tank — для файлов. */
function uiId(key: UiIcon): string {
  const source: string | { file: string } = UI_ICONS[key];
  return typeof source === 'string' ? `ui_${key}` : `lfg_${source.file.replace(/\.\w+$/, '')}`;
}

const ALL_ICONS: IconSource[] = [
  ...CLASSES,
  ...SPECS,
  ...(Object.keys(UI_ICONS) as UiIcon[]).map((key) => {
    const source: string | { file: string } = UI_ICONS[key];
    return typeof source === 'string' ? { id: uiId(key), icon: source } : { id: uiId(key), file: source.file };
  }),
];

async function iconImage({ icon, file }: IconSource): Promise<Buffer> {
  if (file) return readFile(new URL(`../../assets/role-icons/${file}`, import.meta.url));
  const response = await fetch(iconUrl(icon ?? ''));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

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
    for (const source of missing) {
      const { id } = source;
      try {
        const emoji = await client.application.emojis.create({ attachment: await iconImage(source), name: emojiName(id) });
        loaded.set(emojiName(id), { id: emoji.id, name: emojiName(id) });
      } catch (error) {
        failed++;
        console.error(`Не удалось загрузить иконку ${source.icon ?? source.file}:`, error instanceof Error ? error.message : error);
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
  return asText(uiId(key)) ?? UI_FALLBACK[key];
}

/** Иконка оформления для кнопок и пунктов меню. */
export function uiComponentEmoji(key: UiIcon): APIMessageComponentEmoji {
  return loaded.get(emojiName(uiId(key))) ?? { name: UI_FALLBACK[key] };
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
