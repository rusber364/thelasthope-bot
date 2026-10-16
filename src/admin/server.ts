// Веб-админка бота: тот же процесс, что и бот, поэтому видит его кэш (каналы, роли) и ту же базу.
// Слушает только 127.0.0.1 — открывается с этого же компьютера. На VPS ставится за прокси с HTTPS.
import { readFile } from 'node:fs/promises';
import { serve } from '@hono/node-server';
import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type GuildMember,
} from 'discord.js';
import { Hono, type Context } from 'hono';
import { LOG_CATEGORIES, getSettings, saveSettings, validateSettings, type ArchiveMode, type BotSettings, type RaidSchedule, type VoiceRoleLink } from '../botSettings.ts';
import { config } from '../config.ts';
import { applyBranding, brandingError } from '../lib/branding.ts';
import { syncVoiceRoles } from '../lib/voiceRoles.ts';
import { refreshStickies } from '../lib/sticky.ts';
import { sendWelcome } from '../events/guildMemberAdd.ts';
import { sendFarewell } from '../welcome/farewell.ts';
import { sendWelcomeDm, type WelcomeDmResult } from '../welcome/dm.ts';
import { LOG_COLORS, sendLog, sendTestLogs } from '../logs/send.ts';
import { listPolls } from '../polls/store.ts';
import { listRaids } from '../raids/store.ts';
import { clearSession, finishLogin, readSession, saveSession, startLogin, type Session } from './auth.ts';
import {
  alertsPage,
  channelsPage,
  deniedPage,
  homePage,
  loginPage,
  logsPage,
  raidsPage,
  stickyPage,
  welcomePage,
  type Option,
  type PageContext,
} from './views.ts';

type Body = Record<string, string | File | (string | File)[]>;
type Env = { Variables: { session: Session; member: GuildMember; guild: Guild; body: Body } };

const LOGO = new URL('../../logo.jpg', import.meta.url);
const PUBLIC_PATHS = new Set(['/', '/login', '/auth/callback', '/logo.jpg', '/logout']);

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

export function createApp(client: Client<true>) {
  const app = new Hono<Env>();

  app.get('/logo.jpg', async (c) => c.body(await readFile(LOGO), 200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=86400' }));
  app.get('/login', (c) => startLogin(c));
  app.get('/logout', (c) => {
    clearSession(c);
    return c.redirect('/');
  });
  app.get('/auth/callback', async (c) => {
    const user = await finishLogin(c);
    if (!user) return c.html(loginPage('Не получилось войти. Попробуй ещё раз.'), 400);
    await saveSession(c, user);
    return c.redirect('/');
  });

  // Всё остальное — только для админов сервера. Права перепроверяются на каждом запросе.
  app.use('*', async (c, next) => {
    const session = await readSession(c);
    if (!session) {
      if (PUBLIC_PATHS.has(c.req.path)) return next();
      return c.redirect('/');
    }
    const guild = adminGuild(client);
    const member = guild ? await guild.members.fetch(session.userId).catch(() => null) : null;
    if (!guild || !member?.permissions.has(PermissionFlagsBits.ManageGuild)) return c.html(deniedPage(), 403);

    if (c.req.method === 'POST') {
      // Разбираем форму один раз (all: true — чтобы несколько галочек с одним именем не потерялись).
      const body = await c.req.parseBody({ all: true });
      if (text(body._csrf) !== session.csrf) return c.text('Форма устарела — обнови страницу.', 403);
      c.set('body', body);
    }
    c.set('session', session);
    c.set('member', member);
    c.set('guild', guild);
    return next();
  });

  const ctx = (c: Context<Env>, active: PageContext['active'], extra: Partial<PageContext> = {}): PageContext => {
    const session = c.get('session');
    return { user: { name: session.name, avatar: session.avatar }, csrf: session.csrf, active, notice: c.req.query('ok'), ...extra };
  };
  const done = (c: Context<Env>, path: string, notice = 'Сохранено.') => c.redirect(`${path}?ok=${encodeURIComponent(notice)}`);

  app.get('/', async (c) => {
    if (!c.get('session')) return c.html(loginPage());
    const guild = c.get('guild');
    // Баннер приходит только с полным профилем — подгружаем его.
    await client.user.fetch().catch(() => null);
    return c.html(
      homePage(ctx(c, 'home'), {
        bot: client.user.tag,
        guild: guild.name,
        members: guild.memberCount,
        ping: client.ws.ping,
        openRaids: listRaids(guild.id, 'open').length,
        polls: listPolls(guild.id).length,
        avatarUrl: client.user.displayAvatarURL({ size: 128 }),
        bannerUrl: client.user.bannerURL({ size: 512 }) ?? null, // Discord принимает только степени двойки
      }),
    );
  });

  // --- Оформление бота ---
  app.post('/branding/:part', async (c) => {
    const part = c.req.param('part');
    if (part !== 'avatar' && part !== 'banner') return c.notFound();
    const name = part === 'avatar' ? 'Аватар' : 'Баннер';
    try {
      await applyBranding(client.rest, part);
    } catch (error) {
      return done(c, '/', brandingError(error));
    }
    await sendLog(
      c.get('guild'),
      'server',
      new EmbedBuilder()
        .setColor(LOG_COLORS.update)
        .setTitle('Оформление бота изменено в админке')
        .setDescription(`**Кто:** <@${c.get('session').userId}>\n**Что:** ${name.toLowerCase()} бота`),
    );
    return done(c, '/', `${name} бота обновлён. В Discord изменения видны через несколько секунд.`);
  });

  // --- Каналы и роли ---
  app.get('/channels', (c) => {
    const guild = c.get('guild');
    return c.html(channelsPage(ctx(c, 'channels'), getSettings(), textChannels(guild), roleOptions(guild), voiceChannels(guild)));
  });
  app.post('/channels', async (c) => {
    const guild = c.get('guild');
    const body = c.get('body');
    const next = structuredClone(getSettings());
    const errors: string[] = [];
    next.channels.welcome = pickChannel(guild, body.welcome, 'Канал приветствия', errors);
    next.channels.rules = pickChannel(guild, body.rules, 'Канал правил', errors);
    next.channels.auth = pickChannel(guild, body.auth, 'Канал авторизации', errors);
    next.roles.guest = pickRole(guild, body.guest, 'Роль «Гость»', errors);
    next.roles.autorole = pickRole(guild, body.autorole, 'Автороль', errors);
    next.voiceRoles = readVoiceRoles(guild, body, errors);
    const response = await save(c, next, errors, 'Каналы и роли', '/channels', (s, e) =>
      channelsPage(ctx(c, 'channels', { errors: e }), s, textChannels(guild), roleOptions(guild), voiceChannels(guild)),
    );
    // Связки могли измениться — сразу приводим роли в соответствие с теми, кто сейчас в голосовых.
    if (response.status === 302) await syncVoiceRoles(guild).catch((error) => console.error('Голосовые роли:', error));
    return response;
  });

  // --- Логи ---
  app.get('/logs', (c) => c.html(logsPage(ctx(c, 'logs'), getSettings(), textChannels(c.get('guild')))));
  app.post('/logs', async (c) => {
    const guild = c.get('guild');
    const body = c.get('body');
    const next = structuredClone(getSettings());
    const errors: string[] = [];
    for (const category of LOG_CATEGORIES) {
      next.logs[category] = {
        channelId: pickChannel(guild, body[`${category}_channel`], `Канал ${category}`, errors),
        enabled: body[`${category}_enabled`] === 'on',
      };
    }
    return save(c, next, errors, 'Логи', '/logs', (s, e) => logsPage(ctx(c, 'logs', { errors: e }), s, textChannels(guild)));
  });
  app.post('/logs/test', async (c) => {
    const sent = await sendTestLogs(c.get('guild'), `<@${c.get('session').userId}>`);
    return done(c, '/logs', sent.length ? `Тестовое сообщение отправлено в каналов: ${sent.length}. Сначала сохрани изменения, если менял каналы.` : 'Ни один лог-канал не выбран или не включён.');
  });

  // --- Оповещения ---
  app.get('/alerts', (c) => {
    const guild = c.get('guild');
    return c.html(alertsPage(ctx(c, 'alerts'), getSettings(), textChannels(guild), voiceChannels(guild), roleOptions(guild)));
  });
  app.post('/alerts', async (c) => {
    const guild = c.get('guild');
    const body = c.get('body');
    const next = structuredClone(getSettings());
    const errors: string[] = [];
    next.alerts = {
      channelId: pickChannel(guild, body.alertsChannel, 'Канал оповещений', errors),
      roleId: pickRole(guild, body.alertsRole, 'Роль для упоминания', errors),
      lateCancelHours: Number(text(body.lateCancelHours)),
    };
    next.raids.gatherMinutes = Number(text(body.gatherMinutes));
    next.raids.attendanceMinutes = Number(text(body.attendanceMinutes));
    next.raids.attendanceVoiceChannelId = pickVoiceChannel(guild, body.attendanceVoice, 'Голосовой канал рейда', errors);
    return save(c, next, errors, 'Оповещения', '/alerts', (s, e) =>
      alertsPage(ctx(c, 'alerts', { errors: e }), s, textChannels(guild), voiceChannels(guild), roleOptions(guild)),
    );
  });

  // --- Приветствие ---
  app.get('/welcome', (c) => c.html(welcomePage(ctx(c, 'welcome'), getSettings(), textChannels(c.get('guild')))));
  app.post('/welcome', async (c) => {
    const body = c.get('body');
    const next = structuredClone(getSettings());
    next.welcome = {
      text: text(body.text),
      guestOffer: text(body.guestOffer),
      guestButton: text(body.guestButton),
      rulesButton: text(body.rulesButton),
    };
    return save(c, next, [], 'Приветствие', '/welcome', (s, e) => welcomePage(ctx(c, 'welcome', { errors: e }), s, textChannels(c.get('guild'))));
  });
  app.post('/welcome/test', async (c) => {
    const sent = await sendWelcome(c.get('member'));
    return done(c, '/welcome', sent ? 'Пробное приветствие отправлено в канал приветствия.' : 'Канал приветствия не выбран или боту туда нельзя писать.');
  });

  // --- Приветствие в личку ---
  app.post('/welcome/dm', async (c) => {
    const body = c.get('body');
    const next = structuredClone(getSettings());
    next.welcomeDm = { enabled: text(body.dmEnabled) === 'on', text: text(body.dmText) };
    return save(c, next, [], 'Приветствие в личку', '/welcome', (s, e) => welcomePage(ctx(c, 'welcome', { errors: e }), s, textChannels(c.get('guild'))));
  });
  app.post('/welcome/dm/test', async (c) => {
    const result = await sendWelcomeDm(c.get('member'), true);
    const messages: Record<WelcomeDmResult, string> = {
      sent: 'Пробное приветствие отправлено тебе в личку.',
      closed: 'Не получилось: у тебя закрыты личные сообщения от участников сервера (ПКМ по иконке сервера → Настройки конфиденциальности).',
      failed: 'Не получилось отправить — подробности в консоли бота.',
      off: '',
    };
    return done(c, '/welcome', messages[result]);
  });

  // --- Прощание ---
  app.post('/farewell', async (c) => {
    const guild = c.get('guild');
    const body = c.get('body');
    const next = structuredClone(getSettings());
    const errors: string[] = [];
    next.farewell = { channelId: pickChannel(guild, body.farewellChannel, 'Канал прощаний', errors), text: text(body.farewellText) };
    return save(c, next, errors, 'Прощание', '/welcome', (s, e) => welcomePage(ctx(c, 'welcome', { errors: e }), s, textChannels(guild)));
  });
  app.post('/farewell/test', async (c) => {
    const sent = await sendFarewell(c.get('member'));
    return done(c, '/welcome', sent ? 'Пробное прощание отправлено в канал прощаний.' : 'Канал прощаний не выбран или боту туда нельзя писать.');
  });

  // --- Липкие сообщения ---
  app.get('/sticky', (c) => c.html(stickyPage(ctx(c, 'sticky'), getSettings(), textChannels(c.get('guild')))));
  app.post('/sticky', async (c) => {
    const guild = c.get('guild');
    const body = c.get('body');
    const next = structuredClone(getSettings());
    const errors: string[] = [];
    next.sticky = { intervalSeconds: Number(text(body.interval)), items: readStickies(guild, body, errors) };
    const response = await save(c, next, errors, 'Липкие сообщения', '/sticky', (s, e) => stickyPage(ctx(c, 'sticky', { errors: e }), s, textChannels(guild)));
    // Сразу показать новые тексты и убрать закрепы из каналов, где их больше нет.
    if (response.status === 302) await refreshStickies(guild, true).catch((error) => console.error('Закрепы:', error));
    return response;
  });

  // --- Расписание рег ---
  app.get('/raids', (c) => c.html(raidsPage(ctx(c, 'raids'), getSettings(), textChannels(c.get('guild')), roleOptions(c.get('guild')))));
  app.post('/raids', async (c) => {
    const guild = c.get('guild');
    const body = c.get('body');
    const next = structuredClone(getSettings());
    const errors: string[] = [];
    next.raids.defaultSize = Number(text(body.defaultSize));
    next.raids.defaultTime = text(body.defaultTime);
    next.raids.tempRoleId = pickRole(guild, body.tempRole, 'Временная роль', errors);
    next.raids.tempRoleHours = Number(text(body.tempRoleHours));
    next.raids.archive = {
      mode: text(body.archiveMode) as ArchiveMode,
      channelId: pickChannel(guild, body.archiveChannel, 'Канал-архив', errors),
      hours: Number(text(body.archiveHours)),
    };
    next.raids.schedules = readSchedules(guild, body, errors);
    return save(c, next, errors, 'Расписание рег', '/raids', (s, e) => raidsPage(ctx(c, 'raids', { errors: e }), s, textChannels(guild), roleOptions(guild)));
  });
  app.post('/raids/add', async (c) => {
    const next = structuredClone(getSettings());
    next.raids.schedules.push({
      id: `s${Date.now().toString(36)}`,
      title: 'Новый рейд',
      channelId: null,
      days: [4],
      openAt: '00:00',
      raidDayOffset: 0,
      raidTime: next.raids.defaultTime,
      pingRoleId: null,
    });
    saveSettings(next);
    return done(c, '/raids', 'Расписание добавлено внизу — выбери канал и сохрани.');
  });

  /** Проверить, сохранить, записать в «лог-сервер». При ошибках — та же страница с ошибками и введёнными значениями. */
  async function save(
    c: Context<Env>,
    next: BotSettings,
    errors: string[],
    section: string,
    path: string,
    render: (s: BotSettings, errors: string[]) => ReturnType<typeof channelsPage>,
  ) {
    errors.push(...validateSettings(next));
    if (errors.length) return c.html(render(next, errors), 400);
    saveSettings(next);
    await sendLog(
      c.get('guild'),
      'server',
      new EmbedBuilder()
        .setColor(LOG_COLORS.update)
        .setTitle('Настройки бота изменены в админке')
        .setDescription(`**Кто:** <@${c.get('session').userId}>\n**Раздел:** ${section}`),
    );
    return done(c, path);
  }

  return app;
}

// --- Помощники для форм ---

function text(value: Body[string] | undefined): string {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' ? first.replace(/\r\n/g, '\n').trim() : '';
}

function list(value: Body[string] | undefined): string[] {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).filter((v): v is string => typeof v === 'string');
}

const TEXT_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);

function textChannels(guild: Guild): Option[] {
  return guild.channels.cache
    .filter((channel) => TEXT_TYPES.has(channel.type))
    .sort((a, b) => ('rawPosition' in a && 'rawPosition' in b ? a.rawPosition - b.rawPosition : 0))
    .sort((a, b) => (a.parent?.rawPosition ?? -1) - (b.parent?.rawPosition ?? -1))
    .map((channel) => ({ id: channel.id, name: `#${channel.name}`, ...(channel.parent ? { group: channel.parent.name } : {}) }));
}

const VOICE_TYPES = new Set([ChannelType.GuildVoice, ChannelType.GuildStageVoice]);

function voiceChannels(guild: Guild): Option[] {
  return guild.channels.cache
    .filter((channel) => VOICE_TYPES.has(channel.type))
    .sort((a, b) => ('rawPosition' in a && 'rawPosition' in b ? a.rawPosition - b.rawPosition : 0))
    .map((channel) => ({ id: channel.id, name: `🔊 ${channel.name}`, ...(channel.parent ? { group: channel.parent.name } : {}) }));
}

function pickVoiceChannel(guild: Guild, value: Body[string] | undefined, name: string, errors: string[]): string | null {
  const id = text(value);
  if (!id) return null;
  const channel = guild.channels.cache.get(id);
  if (!channel || !VOICE_TYPES.has(channel.type)) {
    errors.push(`${name}: такого голосового канала нет на сервере.`);
    return null;
  }
  return id;
}

function roleOptions(guild: Guild): Option[] {
  return guild.roles.cache
    .filter((role) => role.id !== guild.id && !role.managed)
    .sort((a, b) => b.position - a.position)
    .map((role) => ({
      id: role.id,
      name: role.name,
      ...(role.editable ? {} : { warning: 'Роль стоит выше роли бота — бот не сможет её выдать. Подними роль бота в настройках сервера.' }),
    }));
}

function pickChannel(guild: Guild, value: Body[string] | undefined, name: string, errors: string[]): string | null {
  const id = text(value);
  if (!id) return null;
  const channel = guild.channels.cache.get(id);
  if (!channel || !TEXT_TYPES.has(channel.type)) {
    errors.push(`${name}: такого текстового канала нет на сервере.`);
    return null;
  }
  return id;
}

function pickRole(guild: Guild, value: Body[string] | undefined, name: string, errors: string[]): string | null {
  const id = text(value);
  if (!id) return null;
  const role = guild.roles.cache.get(id);
  if (!role || role.id === guild.id || role.managed) {
    errors.push(`${name}: такой роли нет на сервере.`);
    return null;
  }
  return id;
}

function readStickies(guild: Guild, body: Body, errors: string[]): { channelId: string; text: string }[] {
  const count = Number(text(body.count)) || 0;
  const items: { channelId: string; text: string }[] = [];
  for (let i = 0; i < count; i++) {
    if (text(body[`st${i}_delete`]) === 'on') continue;
    const channelRaw = text(body[`st${i}_channel`]);
    const stickyText = text(body[`st${i}_text`]);
    if (!channelRaw && !stickyText) continue; // пустая строка для нового
    items.push({ channelId: pickChannel(guild, channelRaw, `Липкое сообщение ${i + 1}`, errors) ?? '', text: stickyText });
  }
  return items;
}

function readVoiceRoles(guild: Guild, body: Body, errors: string[]): VoiceRoleLink[] {
  const count = Number(text(body.vrCount)) || 0;
  const links: VoiceRoleLink[] = [];
  for (let i = 0; i < count; i++) {
    if (text(body[`vr${i}_delete`]) === 'on') continue;
    const channelRaw = text(body[`vr${i}_channel`]);
    const roleRaw = text(body[`vr${i}_role`]);
    if (!channelRaw && !roleRaw) continue; // пустая строка для новой связки
    const channelId = pickVoiceChannel(guild, channelRaw, `Голосовая роль ${i + 1}`, errors) ?? '';
    const roleId = pickRole(guild, roleRaw, `Голосовая роль ${i + 1}`, errors) ?? '';
    if (!links.some((l) => l.channelId === channelId && l.roleId === roleId)) links.push({ channelId, roleId });
  }
  return links;
}

function readSchedules(guild: Guild, body: Body, errors: string[]): RaidSchedule[] {
  const count = Number(text(body.count)) || 0;
  const schedules: RaidSchedule[] = [];
  for (let i = 0; i < count; i++) {
    const p = `s${i}`;
    if (text(body[`${p}_delete`]) === 'on') continue;
    schedules.push({
      id: text(body[`${p}_id`]) || `s${Date.now().toString(36)}${i}`,
      title: text(body[`${p}_title`]),
      channelId: pickChannel(guild, body[`${p}_channel`], `Расписание ${i + 1}: канал`, errors),
      days: list(body[`${p}_days`]).map(Number).sort((a, b) => a - b),
      openAt: text(body[`${p}_openAt`]),
      raidDayOffset: Number(text(body[`${p}_offset`])),
      raidTime: text(body[`${p}_raidTime`]),
      pingRoleId: pickRole(guild, body[`${p}_ping`], `Расписание ${i + 1}: роль`, errors),
    });
  }
  return schedules;
}
