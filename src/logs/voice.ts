// «лог-голос»: вход, выход и переходы между голосовыми каналами.
import { EmbedBuilder, Events, type Client } from 'discord.js';
import { LOG_COLORS, sendLog } from './send.ts';

export function registerVoiceLogs(client: Client): void {
  client.on(Events.VoiceStateUpdate, async (before, after) => {
    const member = after.member ?? before.member;
    if (!member || member.user.bot) return;
    // Мут, отключение звука, стрим и т.п. тоже приходят сюда — логируем только смену канала.
    if (before.channelId === after.channelId) return;

    const embed = new EmbedBuilder().setFooter({ text: `ID: ${member.id}` }).setAuthor({
      name: `${member.displayName} · ${member.user.tag}`,
      iconURL: member.displayAvatarURL(),
    });

    if (!before.channelId && after.channelId) {
      embed.setColor(LOG_COLORS.create).setTitle('Вход в голосовой канал').setDescription(`${member} → <#${after.channelId}>`);
    } else if (before.channelId && !after.channelId) {
      embed.setColor(LOG_COLORS.delete).setTitle('Выход из голосового канала').setDescription(`${member} ← <#${before.channelId}>`);
    } else {
      embed
        .setColor(LOG_COLORS.update)
        .setTitle('Переход в другой голосовой канал')
        .setDescription(`${member}: <#${before.channelId}> → <#${after.channelId}>`);
    }

    await sendLog(after.guild, 'voice', embed);
  });
}
