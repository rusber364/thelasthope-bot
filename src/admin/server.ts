// Веб-админка бота: тот же процесс, что и бот, поэтому видит его кэш (каналы, роли) и ту же базу.
// Слушает только 127.0.0.1 — открывается с этого же компьютера. На VPS ставится за прокси с HTTPS.
// Интерфейс — приложение admin-ui (React), собранное `pnpm build` в admin-ui/dist; бот отдаёт его файлы
// и JSON API (/api, api.ts). Вход — Discord OAuth и подписанная cookie-сессия (auth.ts).
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Client, Guild } from 'discord.js';
import { Hono, type MiddlewareHandler } from 'hono';
import { config } from '../config.ts';
import { createApi } from './api.ts';
import { clearSession, finishLogin, saveSession, startLogin } from './auth.ts';

const LOGO = new URL('../../logo.jpg', import.meta.url);
/** Собранный интерфейс; ADMIN_UI_DIST — другой путь (для тестов). */
const distDir = () => process.env.ADMIN_UI_DIST ?? fileURLToPath(new URL('../../admin-ui/dist', import.meta.url));

export function startAdmin(client: Client<true>): void {
  if (!config.clientSecret || !config.sessionSecret || !config.clientId) {
    console.log('ℹ️ Админка выключена: задай CLIENT_ID, DISCORD_CLIENT_SECRET и SESSION_SECRET в .env.');
    return;
  }
  const app = createApp(client);
  serve({ fetch: app.fetch, port: config.adminPort, hostname: '127.0.0.1' }, () => {
    console.log(`🛠️ Админка: ${config.adminUrl}`);
  });
}

/** Сервер, которым управляет бот: из GUILD_ID или первый, где бот состоит. */
function adminGuild(client: Client<true>): Guild | undefined {
  return (config.guildId && client.guilds.cache.get(config.guildId)) || client.guilds.cache.first();
}

/** Страница вместо админки, если интерфейс не собран. */
const NOT_BUILT = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Админка не собрана</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1220;color:#e6e8f0;font:16px/1.5 system-ui,sans-serif}
main{max-width:30rem;padding:2rem;border:1px solid #2a3050;border-radius:12px;background:#181c2e}code{color:#d4a73c}</style></head>
<body><main><h1>Админка не собрана</h1><p>Бот работает, но интерфейс админки ещё не собран. В папке бота выполни <code>pnpm build</code> и обнови страницу.</p></main></body></html>`;

export function createApp(client: Client<true>) {
  const app = new Hono();

  // --- Вход через Discord ---
  app.get('/login', (c) => startLogin(c));
  app.get('/logout', (c) => {
    clearSession(c);
    return c.redirect('/');
  });
  app.get('/auth/callback', async (c) => {
    const user = await finishLogin(c);
    if (!user) return c.redirect('/?login-failed');
    await saveSession(c, user);
    return c.redirect('/');
  });
  app.get('/logo.jpg', async (c) => c.body(await readFile(LOGO), 200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=86400' }));

  // --- Данные: вход, права «Управлять сервером» и CSRF проверяются в самом API ---
  app.route('/api', createApi(client, () => adminGuild(client)));

  // --- Интерфейс ---
  // Файлы сборки с хешем в имени не меняются — кэшируем надолго; index.html — всегда свежий.
  // Раздачу включаем, когда сборка появилась: `pnpm build` можно запустить и при работающем боте.
  let files: MiddlewareHandler | null = null;
  app.use('*', (c, next) => {
    files ??= existsSync(distDir()) ? serveStatic({ root: distDir() }) : null;
    if (!files) return next();
    c.header('Cache-Control', c.req.path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
    return files(c, next);
  });
  app.get('/assets/*', (c) => {
    c.header('Cache-Control', 'no-store'); // файла нет (старая сборка) — не запоминать ответ
    return c.notFound();
  });
  // Остальные адреса (/channels, /polls/5 …) — маршруты внутри приложения: отдаём index.html.
  app.get('*', async (c) => {
    const index = await readFile(`${distDir()}/index.html`, 'utf8').catch(() => null);
    if (index === null) return c.html(NOT_BUILT, 503);
    c.header('Cache-Control', 'no-cache');
    return c.html(index);
  });

  return app;
}
