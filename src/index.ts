import { Client, Events, GatewayIntentBits } from 'discord.js';
import { config } from './config.ts';
import { registerReadyEvent } from './events/ready.ts';
import { registerInteractionEvent } from './events/interactionCreate.ts';
import { registerWelcomeEvent } from './events/guildMemberAdd.ts';
import { registerProfanityFilter } from './events/profanityFilter.ts';

// Client — это сам бот. После login() он держит постоянное соединение с Discord (Gateway)
// и получает оттуда события: «бот готов», «кто-то вызвал команду», «зашёл новый участник»…
const client = new Client({
  // Intents — на какие группы событий бот подписывается. Discord присылает только их.
  // «Привилегированные» (отмечены ★) нужно включить вручную в Developer Portal → Bot.
  intents: [
    GatewayIntentBits.Guilds, // серверы, каналы, роли — нужно почти всегда
    GatewayIntentBits.GuildMembers, // ★ Server Members Intent — вход участников (приветствие)
    GatewayIntentBits.GuildMessages, // новые сообщения (фильтр мата)
    GatewayIntentBits.MessageContent, // ★ Message Content Intent — текст сообщений (фильтр мата)
  ],
});

// Подписываемся на события — каждое описано в своём файле в папке events/.
registerReadyEvent(client);
registerInteractionEvent(client);
registerWelcomeEvent(client);
registerProfanityFilter(client);

client.on(Events.Error, (error) => console.error('Ошибка клиента Discord:', error));
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
