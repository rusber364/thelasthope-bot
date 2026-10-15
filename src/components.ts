import type { ComponentHandler } from './types.ts';
import { roleButtonHandler } from './lib/roleButtons.ts';
import { welcomeHandler } from './welcome/welcome.ts';
import { raidHandler } from './raids/handlers.ts';
import { pollHandler } from './polls/handlers.ts';

/** Все обработчики кнопок, меню и форм — по префиксу customId. */
const handlers: ComponentHandler[] = [roleButtonHandler, welcomeHandler, raidHandler, pollHandler];

export const componentHandlers = new Map(handlers.map((handler) => [handler.prefix, handler]));
