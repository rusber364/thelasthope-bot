// Секреты и настройки запуска берутся из переменных окружения.
// Node подхватывает их из файла .env благодаря флагу --env-file в package.json.
// ID каналов и ролей отсюда — только начальные значения: дальше их меняют в админке (botSettings.ts).

function read(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function required(name: string): string {
  const value = read(name);
  if (!value) {
    console.error(`❌ Не задана переменная ${name}. Заполни файл .env (образец — .env.example).`);
    process.exit(1);
  }
  return value;
}

export const config = {
  /** Токен читается при обращении: бот и скрипты без него не запустятся, а тестам он не нужен. */
  get token(): string {
    return required('DISCORD_TOKEN');
  },
  clientId: read('CLIENT_ID'),
  guildId: read('GUILD_ID'),

  welcomeChannelId: read('WELCOME_CHANNEL_ID'),
  rulesChannelId: read('RULES_CHANNEL_ID'),
  authChannelId: read('AUTH_CHANNEL_ID'),
  guestRoleId: read('GUEST_ROLE_ID'),
  autoroleId: read('AUTOROLE_ID'),

  modLogChannelId: read('MOD_LOG_CHANNEL_ID'),

  raidChannel1Id: read('RAID_CHANNEL_1_ID'),
  raidChannel2Id: read('RAID_CHANNEL_2_ID'),

  // Админка (src/admin). Без секретов она не запускается.
  clientSecret: read('DISCORD_CLIENT_SECRET'),
  sessionSecret: read('SESSION_SECRET'),
  adminPort: Number(read('ADMIN_PORT') ?? 3000),
  /** Адрес, по которому админку открывают в браузере. На VPS — https://твой-домен. */
  get adminUrl(): string {
    return (read('ADMIN_URL') ?? `http://localhost:${this.adminPort}`).replace(/\/+$/, '');
  },
};
