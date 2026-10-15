// Регистрирует слэш-команды в Discord. Запускать после добавления новой команды
// или изменения параметров существующей: `pnpm deploy`.
// Сам бот при этом может быть выключен — это обычный HTTP-запрос к API Discord.
import { DiscordAPIError, REST, RESTJSONErrorCodes, Routes } from 'discord.js';
import { config } from './config.ts';
import { commands } from './commands/index.ts';
import { inviteUrl } from './lib/invite.ts';

const { clientId, guildId } = config;
if (!clientId) {
  console.error('❌ Не задан CLIENT_ID в .env (Developer Portal → General Information → Application ID).');
  process.exit(1);
}

const body = commands.map((command) => command.data.toJSON());
const rest = new REST().setToken(config.token);

// Команды сервера появляются сразу, глобальные — с задержкой до часа.
const route = guildId ? Routes.applicationGuildCommands(clientId, guildId) : Routes.applicationCommands(clientId);

try {
  await rest.put(route, { body });
} catch (error) {
  if (guildId && error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.MissingAccess) {
    console.error(
      [
        `❌ Бота нет на сервере ${guildId} (или его добавили без слэш-команд).`,
        '   Сначала пригласи бота по этой ссылке, потом снова запусти pnpm deploy:',
        `   ${inviteUrl(clientId)}`,
        '   Если бот уже на сервере — проверь, что в GUILD_ID стоит ID сервера, а не канала.',
      ].join('\n'),
    );
    process.exit(1);
  }
  if (guildId && error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownGuild) {
    console.error(`❌ Сервер ${guildId} не найден. Проверь GUILD_ID в .env: ПКМ по иконке сервера → «Копировать ID сервера».`);
    process.exit(1);
  }
  throw error;
}

const where = guildId ? `на сервере ${guildId}` : 'глобально';
console.log(`✅ Зарегистрировано команд ${where}: ${body.length} (${commands.map((c) => '/' + c.data.name).join(', ')})`);

// Если раньше команды регистрировались глобально, на сервере они показались бы дважды — убираем глобальные.
if (guildId) {
  const removed = (await rest.put(Routes.applicationCommands(clientId), { body: [] })) as unknown[];
  console.log(`🧹 Глобальные команды очищены, чтобы не было дублей (осталось: ${removed.length}).`);
}
