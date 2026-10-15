import { MessageFlags, type InteractionReplyOptions } from 'discord.js';

/** Команда, кнопка, меню или форма — всё, на что можно ответить. */
interface Repliable {
  reply(options: InteractionReplyOptions): Promise<unknown>;
}

/** Ответ, который видит только тот, кто вызвал команду или нажал кнопку. */
export async function replyEphemeral(interaction: Repliable, content: string): Promise<void> {
  await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}
