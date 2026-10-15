import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  MessageComponentInteraction,
  ModalSubmitInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';

/** Одна слэш-команда: её описание для Discord и код, который выполняется при вызове. */
export interface Command {
  /** Имя, описание, параметры и права команды. Отправляется в Discord через `pnpm deploy`. */
  data: {
    name: string;
    toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody;
  };
  /** Вызывается, когда кто-то использует команду на сервере. */
  execute(interaction: ChatInputCommandInteraction<'cached'>): Promise<void>;
  /** Подсказки при вводе параметра (например, список рег или опросов). */
  autocomplete?(interaction: AutocompleteInteraction<'cached'>): Promise<void>;
}

export type ComponentInteraction = MessageComponentInteraction<'cached'> | ModalSubmitInteraction<'cached'>;

/**
 * Обработчик кнопок, меню и форм одной функции бота.
 * customId компонентов имеет вид `<prefix>:<действие>:<параметры…>`,
 * по префиксу interactionCreate понимает, кому передать нажатие.
 */
export interface ComponentHandler {
  prefix: string;
  handle(interaction: ComponentInteraction, args: string[]): Promise<void>;
}
