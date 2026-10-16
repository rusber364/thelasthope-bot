import { ActivityType, Events, type Client } from 'discord.js';
import { startAdmin } from '../admin/server.ts';
import { inviteUrl } from '../lib/invite.ts';
import { cacheInvites } from '../logs/invites.ts';
import { syncVoiceRoles } from '../lib/voiceRoles.ts';
import { refreshStickies } from '../lib/sticky.ts';
import { refreshBoard } from '../raids/board.ts';
import { ensureAppEmojis } from '../raids/emojis.ts';
import { startRaidScheduler } from '../raids/scheduler.ts';
import { startTempRoleExpiry } from '../lib/tempRoles.ts';
import { startAutoClean } from '../lib/autoClean.ts';
import { startTempChannelExpiry } from '../lib/tempChannels.ts';

/** Срабатывает один раз, когда бот подключился и загрузил список серверов. */
export function registerReadyEvent(client: Client): void {
  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`✅ Бот запущен как ${readyClient.user.tag}. Серверов: ${readyClient.guilds.cache.size}`);

    readyClient.user.setActivity({ name: 'Азерот', type: ActivityType.Watching });

    // Ссылка, по которой бота можно добавить на сервер, сразу с нужными правами.
    console.log(`🔗 Пригласить бота на сервер: ${inviteUrl(readyClient.application.id)}`);

    // Участники в памяти бота нужны логам: при выходе видно роли и дату входа.
    // Счётчики приглашений — чтобы понять, по чьей ссылке зашёл новичок.
    for (const guild of readyClient.guilds.cache.values()) {
      await guild.members.fetch().catch((error) => console.error(`Не удалось загрузить участников «${guild.name}»:`, error));
      await cacheInvites(guild);
      // Пока бот был выключен, люди могли зайти в голосовые или выйти из них — сверяем голосовые роли.
      await syncVoiceRoles(guild).catch((error) => console.error('Не удалось сверить голосовые роли:', error));
      await refreshStickies(guild).catch((error) => console.error('Не удалось обновить закрепы:', error));
      await refreshBoard(readyClient, guild.id).catch((error) => console.error('Не удалось обновить список рейдов:', error));
    }

    await ensureAppEmojis(readyClient);
    startRaidScheduler(readyClient);
    startTempRoleExpiry(readyClient);
    startAutoClean(readyClient);
    startTempChannelExpiry(readyClient);
    startAdmin(readyClient);
  });
}
