// Секреты и ID каналов/ролей берутся из переменных окружения.
// Node подхватывает их из файла .env благодаря флагу --env-file в package.json.
// Тексты, расписание и прочее поведение — в settings.ts.

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
};
