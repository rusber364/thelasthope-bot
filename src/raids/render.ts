// Как выглядит сообщение реги (в стиле Raid-Helper). Собирается заново при каждом изменении состава.
//
//   [баннер]
//   Название рейда
//   🚩 Автор        👥 28 (+1)      ⏳
//   📅 26 октября   🕗 21:13         через 11 дней
//   🛡 Танки (4)    ⚔ Ближний (10)  🏹 Дальний (10)
//   <спек> `6` Ник  …               …
//   ✚ Лекари (4)
//   ❔ Под вопросом (1): <спек> `11` Ник
//
// Колонки — это «поля» embed'а: Discord ставит по три поля в ряд.
import { existsSync } from 'node:fs';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  TimestampStyles,
  escapeMarkdown,
  time,
  type APIEmbedField,
  type MessageEditOptions,
} from 'discord.js';
import { CLASSES, ROLES, ROLE_ORDER, specById, specsOf, type RaidRole } from './classes.ts';
import { classComponentEmoji, specEmoji, uiComponentEmoji, uiEmoji } from './emojis.ts';
import { KINDS, LIMIT_GROUPS, hasLimits } from './kinds.ts';
import { lineup, roleMentions } from './lineup.ts';
import { plural } from '../lib/plural.ts';
import type { Raid, RaidImage, Signup } from './store.ts';

const ACCENT = 0xc69b3a; // золото
const EMPTY = '​'; // невидимый символ: у поля embed'а не может быть пустого текста
const FIELD_LIMIT = 1024;
const NAME_LIMIT = 20;

// Фон реги: положи картинку (например, Древо Тельдрассил) в assets/raid-banner.jpg (или .png/.webp).
const BANNER_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

/** Есть ли общий фон для рег (assets/raid-banner.*). */
export function hasDefaultBanner(): boolean {
  return findBanner() !== null;
}

/** Общий фон рег из assets (null — его нет). */
export function findBanner(): { path: string; name: string } | null {
  for (const ext of BANNER_EXTENSIONS) {
    const path = fileURLToPath(new URL(`../../assets/raid-banner${ext}`, import.meta.url));
    if (existsSync(path)) return { path, name: `raid-banner${extname(path)}` };
  }
  return null;
}

const STATUS_NOTE: Record<Raid['status'], string | null> = {
  open: null,
  closed: '**Запись закрыта — время начала прошло.**',
  cancelled: '**Отменили.**',
};

/** Полное содержимое сообщения реги (для отправки и для редактирования). image — своя картинка реги вместо общего фона. */
export function buildRaidMessage(raid: Raid, signups: Signup[], image: RaidImage | null = null) {
  const banner = image ?? findBanner();
  const embeds: EmbedBuilder[] = [];
  // Картинка отдельным embed'ом сверху: у одного embed'а она была бы внизу, под составом.
  if (banner) embeds.push(new EmbedBuilder().setColor(ACCENT).setImage(`attachment://${banner.name}`));
  embeds.push(buildRosterEmbed(raid, signups));

  return {
    embeds,
    components: raid.status === 'open' ? buildControls(raid) : [],
    files: banner ? [new AttachmentBuilder('data' in banner ? banner.data : banner.path, { name: banner.name })] : [],
    // При редактировании старая картинка заменяется новой загрузкой — так она гарантированно не пропадёт.
    attachments: [],
    allowedMentions: { parse: [] },
  } satisfies MessageEditOptions;
}

/** Для первой отправки поле attachments не нужно. */
export function buildRaidCreateMessage(raid: Raid, signups: Signup[], pingRoleIds: string[] = [], image: RaidImage | null = null) {
  const { attachments: _ignored, ...message } = buildRaidMessage(raid, signups, image);
  if (!pingRoleIds.length) return message;
  // Упоминание ролей — строкой над регой; при редактировании текст сообщения не меняется и повторно не пингует.
  const mentions = pingRoleIds.map((id) => `<@&${id}>`).join(' ');
  return { ...message, content: `${mentions} открыта запись ${KINDS[raid.kind].to}!`, allowedMentions: { roles: pingRoleIds } };
}

/** «**Подземелье** · 5 мест · 1 танк, 1 лекарь, 3 бойца» — для подземелий, PvP и любых рег с лимитами по ролям. */
export function kindNote(raid: Pick<Raid, 'kind' | 'size' | 'limits'>): string | null {
  if (raid.kind === 'raid' && !hasLimits(raid.limits)) return null;
  const parts = [`**${KINDS[raid.kind].title}**`, `${raid.size} ${plural(raid.size, ['место', 'места', 'мест'])}`];
  const limits = LIMIT_GROUPS.filter(({ group }) => raid.limits[group] !== null).map(({ group, forms }) => {
    const n = raid.limits[group]!;
    return `${n} ${plural(n, forms)}`;
  });
  if (limits.length) parts.push(limits.join(', '));
  return parts.join(' · ');
}

/** «Записываются: @Рейдер, @РЛ · только в запас: @Гость» — если рега не для всех. */
export function accessNote(raid: Pick<Raid, 'mainRoleIds' | 'reserveRoleIds'>): string | null {
  if (!raid.mainRoleIds.length) return null;
  const reserve = raid.reserveRoleIds.length ? ` · только в запас: ${roleMentions(raid.reserveRoleIds)}` : '';
  return `${uiEmoji('signups')} Записываются: ${roleMentions(raid.mainRoleIds)}${reserve}`;
}

function buildRosterEmbed(raid: Raid, signups: Signup[]): EmbedBuilder {
  // Номер — порядок записи, как в Raid-Helper: 1 — тот, кто записался первым.
  const number = new Map(signups.map((signup, index) => [signup.userId, index + 1]));
  const { main, bench, tentative } = lineup(signups, raid.size, raid.limits);

  const line = (signup: Signup) => {
    const spec = specById.get(signup.specId);
    const name = signup.displayName ? `**${escapeMarkdown(signup.displayName.slice(0, NAME_LIMIT))}**` : `<@${signup.userId}>`;
    return `${spec ? specEmoji(spec) : ''} \`${number.get(signup.userId)}\` ${name}`.trim();
  };

  const start = new Date(raid.startsAt);
  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle(raid.title)
    .setFooter({ text: `Рега #${raid.id}` });

  const description = [kindNote(raid), raid.description, accessNote(raid), STATUS_NOTE[raid.status]].filter(Boolean).join('\n\n');
  if (description) embed.setDescription(description);

  // Шапка: три колонки — автор и дата, число записавшихся и время, обратный отсчёт.
  const extra = tentative.length ? ` (+${tentative.length})` : '';
  embed.addFields(
    { name: `${uiEmoji('leader')} ${raid.leaderName ?? 'The Last Hope'}`, value: `${uiEmoji('date')} ${time(start, TimestampStyles.LongDate)}`, inline: true },
    { name: `${uiEmoji('signups')} ${main.length + bench.length}${extra}`, value: `${uiEmoji('time')} ${time(start, TimestampStyles.ShortTime)}`, inline: true },
    { name: EMPTY, value: `${uiEmoji('countdown')} ${time(start, TimestampStyles.RelativeTime)}`, inline: true },
  );

  // Колонки ролей: танки, ближний, дальний — первый ряд; лекари — второй.
  const byRole = new Map<RaidRole, Signup[]>(ROLE_ORDER.map((role) => [role, []]));
  for (const signup of main) byRole.get(specById.get(signup.specId)?.role ?? 'melee')?.push(signup);
  for (const role of ROLE_ORDER) {
    const list = byRole.get(role) ?? [];
    // У танков и лекарей с лимитом — «(1/1)»; лимит бойцов общий на две колонки, он в строке состава.
    const limit = role === 'tank' || role === 'healer' ? raid.limits[role] : null;
    const count = limit === null ? `${list.length}` : `${list.length}/${limit}`;
    embed.addFields(...splitField(`${uiEmoji(role)} __${ROLES[role].title}__ (${count})`, list.map(line), '\n', true));
  }

  // Запас и «под вопросом» — во всю ширину, в одну строку.
  if (bench.length) embed.addFields(...splitField(`${uiEmoji('bench')} Запас (${bench.length})`, bench.map(line), '   ', false));
  if (tentative.length) {
    embed.addFields(...splitField(`${uiEmoji('tentative')} Под вопросом (${tentative.length})`, tentative.map(line), '   ', false));
  }
  return embed;
}

/** Поле embed'а вмещает 1024 символа: если строк больше — продолжение в следующем поле. */
function splitField(name: string, lines: string[], separator: string, inline: boolean): APIEmbedField[] {
  if (!lines.length) return [{ name, value: EMPTY, inline }];
  const fields: APIEmbedField[] = [];
  let value = '';
  for (const line of lines) {
    const next = value ? value + separator + line : line;
    if (next.length > FIELD_LIMIT && value) {
      fields.push({ name: fields.length ? EMPTY : name, value, inline });
      value = line;
    } else {
      value = next;
    }
  }
  fields.push({ name: fields.length ? EMPTY : name, value, inline });
  return fields;
}

/** Меню выбора класса и кнопки под регой. */
function buildControls(raid: Raid) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`raid:class:${raid.id}`)
    .setPlaceholder('Записаться — выбери класс')
    .addOptions(
      CLASSES.map((wowClass) => {
        const emoji = classComponentEmoji(wowClass);
        return {
          label: wowClass.name,
          value: wowClass.id,
          ...(emoji ? { emoji } : {}),
          description: specsOf(wowClass.id)
            .map((spec) => spec.name)
            .join(' · ')
            .slice(0, 100),
        };
      }),
    );

  const buttons = [
    new ButtonBuilder()
      .setCustomId(`raid:maybe:${raid.id}`)
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(uiComponentEmoji('tentative'))
      .setLabel('Под вопросом'),
    new ButtonBuilder()
      .setCustomId(`raid:leave:${raid.id}`)
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(uiComponentEmoji('leave'))
      .setLabel('Отписаться'),
    new ButtonBuilder()
      .setCustomId(`raid:remind:${raid.id}`)
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(uiComponentEmoji('countdown'))
      .setLabel('Напомнить'),
  ];

  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
    new ActionRowBuilder<ButtonBuilder>().addComponents(buttons),
  ];
}
