import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { config } from './config.ts';
import { registerReadyEvent } from './events/ready.ts';
import { registerInteractionEvent } from './events/interactionCreate.ts';
import { registerWelcomeEvent } from './events/guildMemberAdd.ts';
import { registerFarewell } from './welcome/farewell.ts';
import { registerProfanityFilter } from './events/profanityFilter.ts';
import { registerLogs } from './logs/index.ts';
import { registerVoiceRoles } from './lib/voiceRoles.ts';
import { registerSticky } from './lib/sticky.ts';
import { registerRaidWizard } from './raids/wizard.ts';
import { captureConsole } from './lib/botLog.ts';

// Всё, что бот пишет в консоль, копируется в «Лог бота» в админке — с самого запуска.
captureConsole();

// Client — это сам бот. После login() он держит постоянное соединение с Discord (Gateway)
// и получает оттуда события: «бот готов», «кто-то вызвал команду», «зашёл новый участник»…
const client = new Client({
  // Intents — на какие группы событий бот подписывается. Discord присылает только их.
  // «Привилегированные» (отмечены ★) нужно включить вручную в Developer Portal → Bot.
  intents: [
    GatewayIntentBits.Guilds, // серверы, каналы, роли — нужно почти всегда
    GatewayIntentBits.GuildMembers, // ★ Server Members Intent — вход и выход участников
    GatewayIntentBits.GuildMessages, // сообщения (фильтр мата, лог сообщений)
    GatewayIntentBits.MessageContent, // ★ Message Content Intent — текст сообщений
    GatewayIntentBits.GuildVoiceStates, // голосовые каналы (лог голоса)
    GatewayIntentBits.GuildModeration, // журнал аудита и баны (лог сервера и модерации)
    GatewayIntentBits.GuildInvites, // создание и удаление приглашений («кто кого пригласил»)
    GatewayIntentBits.DirectMessages, // личные сообщения боту (создание реги по шагам)
  ],
  // Partials — получать события и про то, чего нет в памяти бота: удаление старых сообщений,
  // выход участника, которого бот ещё не видел, личка, которую бот ещё не открывал.
  partials: [Partials.Message, Partials.GuildMember, Partials.Channel],
});

// Подписываемся на события — каждое описано в своём файле в папках events/ и logs/.
registerReadyEvent(client);
registerInteractionEvent(client);
registerWelcomeEvent(client);
registerFarewell(client);
registerProfanityFilter(client);
registerLogs(client);
registerVoiceRoles(client);
registerSticky(client);
registerRaidWizard(client);

client.on(Events.Error, (error) => console.error('Ошибка клиента Discord:', error));
client.on(Events.Warn, (message) => console.warn('Discord:', message));
// Обрывы связи: пока бот переподключается, события копятся, и реги, логи и ответы могут прийти с опозданием.
client.on(Events.ShardDisconnect, (event) => console.warn(`Связь с Discord прервана (код ${event.code}).`));
client.on(Events.ShardReconnecting, () => console.warn('Переподключаюсь к Discord…'));
client.on(Events.ShardResume, (_shard, replayed) => console.log(`Связь с Discord восстановлена, пропущенных событий: ${replayed}.`));
process.on('unhandledRejection', (error) => console.error('Необработанная ошибка:', error));

try {
  await client.login(config.token);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/disallowed intents/i.test(message)) {
    console.error('❌ Discord не разрешил intents. Включи Server Members Intent и Message Content Intent в Developer Portal → Bot.');
  } else if (/invalid token/i.test(message)) {
    console.error('❌ Неверный токен. Сбрось его в Developer Portal → Bot → Reset Token и обнови .env.');
  } else {
    console.error('❌ Не удалось подключиться к Discord:', error);
  }
  process.exit(1);
}
