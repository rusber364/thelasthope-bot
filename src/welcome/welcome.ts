import {
  ButtonBuilder,
  ButtonStyle,
  Colors,
  ContainerBuilder,
  type GuildMember,
  type MessageCreateOptions,
} from 'discord.js';
import { getSettings } from '../botSettings.ts';
import type { ComponentHandler } from '../types.ts';
import { replyEphemeral } from '../lib/reply.ts';

/**
 * Приветствие собрано из «компонентов» Discord (Components V2): карточка с текстом и аватаркой,
 * под ней кнопки «Получить роль Гость» и «Правила».
 * Функция строит сообщение заново по данным участника — так его легко обновить после нажатия кнопки.
 */
export function buildWelcome(member: GuildMember, guestTaken = false): Pick<MessageCreateOptions, 'components' | 'allowedMentions'> {
  const { guild } = member;
  const { channels, roles, welcome } = getSettings();
  const guestRole = roles.guest ? guild.roles.cache.get(roles.guest) : undefined;

  const fill = (text: string) =>
    text
      .replaceAll('{user}', `${member}`)
      .replaceAll('{server}', guild.name)
      .replaceAll('{rules}', channels.rules ? `<#${channels.rules}>` : 'правилами')
      .replaceAll('{auth}', channels.auth ? `<#${channels.auth}>` : 'авторизацию')
      .replaceAll('{role}', guestRole?.name ?? 'Гость');

  const card = new ContainerBuilder()
    .setAccentColor(Colors.Green)
    .addSectionComponents((section) =>
      section
        .addTextDisplayComponents((text) => text.setContent(fill(welcome.text)))
        .setThumbnailAccessory((thumbnail) => thumbnail.setURL(member.displayAvatarURL({ size: 256 }))),
    );

  const buttons: ButtonBuilder[] = [];
  if (guestRole) {
    card.addTextDisplayComponents((text) => text.setContent(fill(welcome.guestOffer)));
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`welcome:guest:${member.id}`)
        .setStyle(guestTaken ? ButtonStyle.Secondary : ButtonStyle.Success)
        .setEmoji(guestTaken ? '✅' : '🎟️')
        .setLabel(guestTaken ? `Роль «${guestRole.name}» получена` : fill(welcome.guestButton))
        .setDisabled(guestTaken),
    );
  }
  if (channels.rules) {
    // Кнопка-ссылка: открывает канал правил, боту при этом ничего не приходит.
    buttons.push(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setURL(`https://discord.com/channels/${guild.id}/${channels.rules}`)
        .setEmoji('📖')
        .setLabel(welcome.rulesButton),
    );
  }
  if (buttons.length) card.addActionRowComponents((row) => row.addComponents(buttons));

  // Уведомление получит только сам новичок, даже если в тексте упомянуты роли.
  return { components: [card], allowedMentions: { users: [member.id] } };
}

/** Новичок согласился на роль гостя. */
export const welcomeHandler: ComponentHandler = {
  prefix: 'welcome',
  async handle(interaction, [action, userId]) {
    if (!interaction.isButton() || action !== 'guest') return;
    if (interaction.user.id !== userId) {
      return replyEphemeral(interaction, 'Эта кнопка — для новичка, которого приветствует бот 🙂');
    }

    const guestRoleId = getSettings().roles.guest;
    const role = guestRoleId ? interaction.guild.roles.cache.get(guestRoleId) : undefined;
    if (!role) return replyEphemeral(interaction, 'Роль гостя сейчас не настроена — напиши офицерам.');
    if (!role.editable) {
      console.error(`Не могу выдать роль «${role.name}»: роль бота должна быть выше неё.`);
      return replyEphemeral(interaction, 'Не получилось выдать роль — напиши офицерам.');
    }

    if (!interaction.member.roles.cache.has(role.id)) {
      await interaction.member.roles.add(role, 'Приветствие: согласие на роль гостя');
    }
    // update() заменяет само сообщение с кнопкой: кнопка становится серой «Роль получена».
    await interaction.update(buildWelcome(interaction.member, true));
  },
};
