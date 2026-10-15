import { ActivityType, Events, type Client } from 'discord.js';
import { inviteUrl } from '../lib/invite.ts';
import { ensureAppEmojis } from '../raids/emojis.ts';
import { startRaidScheduler } from '../raids/scheduler.ts';

/** Срабатывает один раз, когда бот подключился и загрузил список серверов. */
export function registerReadyEvent(client: Client): void {
  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`✅ Бот запущен как ${readyClient.user.tag}. Серверов: ${readyClient.guilds.cache.size}`);

    readyClient.user.setActivity({ name: 'Азерот', type: ActivityType.Watching });

    // Ссылка, по которой бота можно добавить на сервер, сразу с нужными правами.
    console.log(`🔗 Пригласить бота на сервер: ${inviteUrl(readyClient.application.id)}`);

    await ensureAppEmojis(readyClient);
    startRaidScheduler(readyClient);
  });
}
