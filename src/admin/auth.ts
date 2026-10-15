// Вход в админку через Discord (OAuth2) и сессия в подписанной cookie.
// Discord сообщает только «кто вошёл» (scope identify); права на сервере проверяет сам бот —
// на каждом запросе, так что снятие права «Управлять сервером» сразу закрывает доступ.
import { randomBytes } from 'node:crypto';
import type { Context } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import { config } from '../config.ts';

const SESSION_COOKIE = 'tlh_session';
const STATE_COOKIE = 'tlh_oauth_state';
const SESSION_DAYS = 7;
const API = 'https://discord.com/api/v10';

export interface Session {
  userId: string;
  name: string;
  avatar: string | null;
  /** Токен против подделки форм (CSRF): кладётся в каждую форму и сверяется при отправке. */
  csrf: string;
  expires: number;
}

const secret = () => config.sessionSecret ?? '';
const redirectUri = () => `${config.adminUrl}/auth/callback`;
const cookieOptions = (maxAge: number) => ({
  path: '/',
  httpOnly: true,
  sameSite: 'Lax' as const,
  secure: config.adminUrl.startsWith('https://'),
  maxAge,
});

export async function readSession(c: Context): Promise<Session | null> {
  const raw = await getSignedCookie(c, secret(), SESSION_COOKIE);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as Session;
    return session.expires > Date.now() ? session : null;
  } catch {
    return null;
  }
}

export function clearSession(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

/** Шаг 1: отправляем человека на страницу входа Discord. */
export async function startLogin(c: Context): Promise<Response> {
  const state = randomBytes(16).toString('hex');
  await setSignedCookie(c, STATE_COOKIE, state, secret(), cookieOptions(600));
  const params = new URLSearchParams({
    client_id: config.clientId ?? '',
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'identify',
    state,
  });
  return c.redirect(`https://discord.com/oauth2/authorize?${params}`);
}

/** Шаг 2: Discord вернул код — меняем его на данные пользователя. null — вход не удался. */
export async function finishLogin(c: Context): Promise<Omit<Session, 'csrf' | 'expires'> | null> {
  const expected = await getSignedCookie(c, secret(), STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: '/' });
  const code = c.req.query('code');
  if (!code || !expected || c.req.query('state') !== expected) return null;

  const tokenResponse = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId ?? '',
      client_secret: config.clientSecret ?? '',
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
    }),
  });
  if (!tokenResponse.ok) {
    console.error('Админка: Discord не выдал токен входа:', tokenResponse.status, await tokenResponse.text());
    return null;
  }
  const { access_token: accessToken } = (await tokenResponse.json()) as { access_token: string };

  const userResponse = await fetch(`${API}/users/@me`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!userResponse.ok) return null;
  const user = (await userResponse.json()) as { id: string; username: string; global_name?: string | null; avatar?: string | null };

  return {
    userId: user.id,
    name: user.global_name ?? user.username,
    avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64` : null,
  };
}

export async function saveSession(c: Context, user: Omit<Session, 'csrf' | 'expires'>): Promise<void> {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const session: Session = { ...user, csrf: randomBytes(16).toString('hex'), expires: Date.now() + maxAge * 1000 };
  await setSignedCookie(c, SESSION_COOKIE, JSON.stringify(session), secret(), cookieOptions(maxAge));
}
