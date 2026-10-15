import type { Command } from '../types.ts';
import { ping } from './general/ping.ts';
import { server } from './general/server.ts';
import { user } from './general/user.ts';
import { kick } from './moderation/kick.ts';
import { ban } from './moderation/ban.ts';
import { unban } from './moderation/unban.ts';
import { mute } from './moderation/mute.ts';
import { unmute } from './moderation/unmute.ts';
import { clear } from './moderation/clear.ts';
import { rolepanel } from './roles/rolepanel.ts';
import { raid } from './raids/raid.ts';
import { poll } from './polls/poll.ts';

/**
 * Все команды бота. Чтобы добавить новую: создай файл по образцу ping.ts,
 * допиши её в этот список и выполни `pnpm deploy`.
 */
export const commands: Command[] = [ping, server, user, kick, ban, unban, mute, unmute, clear, rolepanel, raid, poll];

export const commandsByName = new Map(commands.map((command) => [command.data.name, command]));
