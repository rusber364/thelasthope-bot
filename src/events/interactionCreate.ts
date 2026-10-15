import { Events, MessageFlags, type Client, type Interaction } from 'discord.js';
import { commandsByName } from '../commands/index.ts';
import { componentHandlers } from '../components.ts';

/**
 * Interaction (взаимодействие) — любое действие пользователя, адресованное боту:
 * вызов слэш-команды, подсказка при вводе параметра, нажатие кнопки, выбор в меню, отправка формы.
 * Все они приходят в одно событие, и здесь мы решаем, кто будет его обрабатывать.
 */
export function registerInteractionEvent(client: Client): void {
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      await route(interaction);
    } catch (error) {
      console.error('Ошибка при обработке взаимодействия:', error);
      await reportError(interaction);
    }
  });
}

async function route(interaction: Interaction): Promise<void> {
  if (interaction.isChatInputCommand()) {
    const command = commandsByName.get(interaction.commandName);
    if (!command) {
      console.warn(`Неизвестная команда /${interaction.commandName}. Запусти pnpm deploy, чтобы обновить список.`);
      return;
    }
    if (!interaction.inCachedGuild()) {
      await interaction.reply({ content: 'Эта команда работает только на сервере.', flags: MessageFlags.Ephemeral });
      return;
    }
    await command.execute(interaction);
    return;
  }

  if (interaction.isAutocomplete()) {
    const command = commandsByName.get(interaction.commandName);
    if (command?.autocomplete && interaction.inCachedGuild()) await command.autocomplete(interaction);
    return;
  }

  // Кнопки, меню и формы: customId вида «raid:spec:12» → обработчик с префиксом «raid», параметры ["spec", "12"].
  if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
    if (!interaction.inCachedGuild()) return;
    const [prefix = '', ...args] = interaction.customId.split(':');
    await componentHandlers.get(prefix)?.handle(interaction, args);
  }
}

/** На каждое взаимодействие Discord ждёт ответа, иначе пользователь увидит «Приложение не отвечает». */
async function reportError(interaction: Interaction): Promise<void> {
  if (!interaction.isRepliable()) return;
  const content = '😕 Что-то пошло не так. Подробности — в консоли бота.';
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }
  } catch {
    // Ответить уже не получилось (например, истекли 3 секунды на ответ). Ошибка выше всё равно в консоли.
  }
}
