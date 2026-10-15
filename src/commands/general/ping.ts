import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types.ts';

export const ping: Command = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Проверить, что бот жив, и узнать задержку')
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const response = await interaction.reply({ content: 'Считаю…', withResponse: true });
    const sentAt = response.resource?.message?.createdTimestamp ?? Date.now();
    const roundtrip = sentAt - interaction.createdTimestamp;
    await interaction.editReply(`🏓 Понг! Ответ: ${roundtrip} мс, соединение с Discord: ${interaction.client.ws.ping} мс`);
  },
};
