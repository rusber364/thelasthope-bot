import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { Collection, type Client } from 'discord.js';

// Вместо настоящей сборки admin-ui — временная папка: сначала пустая, потом «собранная».
const dist = mkdtempSync(join(tmpdir(), 'tlh-admin-ui-'));
after(() => rmSync(dist, { recursive: true, force: true }));

process.env.BOT_DB_PATH = ':memory:';
process.env.SESSION_SECRET = 'test-secret';
process.env.CLIENT_ID = '1';
process.env.DISCORD_CLIENT_SECRET = 'x';
process.env.ADMIN_UI_DIST = dist;

const { createApp } = await import('./server.ts');

const client = { guilds: { cache: new Collection() } } as unknown as Client<true>;
const app = createApp(client);

test('без сборки — понятная страница «выполни pnpm build», API при этом работает', async () => {
  const page = await app.request('/');
  assert.equal(page.status, 503);
  assert.match(await page.text(), /pnpm build/);

  const me = await app.request('/api/me');
  assert.equal(me.status, 401);
  assert.deepEqual(await me.json(), { errors: ['Нужно войти через Discord.'] });
});

test('сборка подхватывается без перезапуска: файлы, маршруты приложения и кэш', async () => {
  mkdirSync(join(dist, 'assets'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html><div id="root"></div>');
  writeFileSync(join(dist, 'assets', 'index-abc123.js'), 'console.log(1)');
  writeFileSync(join(dist, 'favicon.svg'), '<svg/>');

  const home = await app.request('/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /id="root"/);
  assert.equal(home.headers.get('cache-control'), 'no-cache');

  // Адреса разделов знает только приложение — сервер отдаёт ему index.html.
  for (const path of ['/channels', '/polls/5', '/polls/new']) {
    const res = await app.request(path);
    assert.equal(res.status, 200, path);
    assert.match(await res.text(), /id="root"/, path);
  }

  const script = await app.request('/assets/index-abc123.js');
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type') ?? '', /javascript/);
  assert.match(script.headers.get('cache-control') ?? '', /immutable/);
  assert.equal(await script.text(), 'console.log(1)');

  // Старый файл после пересборки — 404, а не index.html вместо скрипта.
  assert.equal((await app.request('/assets/index-old.js')).status, 404);
  assert.equal((await app.request('/favicon.svg')).status, 200);
  assert.equal((await app.request('/logo.jpg')).headers.get('content-type'), 'image/jpeg');
});

test('вход через Discord: переход на Discord, неудачный вход и выход', async () => {
  const login = await app.request('/login');
  assert.equal(login.status, 302);
  const target = new URL(login.headers.get('location') ?? '');
  assert.equal(target.origin + target.pathname, 'https://discord.com/oauth2/authorize');
  assert.equal(target.searchParams.get('client_id'), '1');
  assert.equal(target.searchParams.get('scope'), 'identify');
  assert.match(login.headers.get('set-cookie') ?? '', /tlh_oauth_state=/);

  // Без кода и state от Discord (или state устарел) — назад на страницу входа с пометкой об ошибке,
  // а прежняя сессия удаляется, чтобы ошибку не заслонил экран «Нет доступа» другого аккаунта.
  const callback = await app.request('/auth/callback');
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get('location'), '/?login-failed');
  assert.match(callback.headers.get('set-cookie') ?? '', /tlh_session=;.*Max-Age=0/);

  const logout = await app.request('/logout');
  assert.equal(logout.status, 302);
  assert.equal(logout.headers.get('location'), '/');
  assert.match(logout.headers.get('set-cookie') ?? '', /tlh_session=;.*Max-Age=0/);
});
