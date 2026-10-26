// JSON API админки (интерфейс — admin-ui): каналы и роли проверяются
// по серверу, настройки — validateSettings, каждое сохранение и действие пишется в «лог-сервер».
// Вход — та же cookie-сессия Discord; права «Управлять сервером» перепроверяются на каждом запросе,
// изменяющие запросы требуют заголовок X-CSRF-Token.
import { readFile } from 'node:fs/promises';
import { EmbedBuilder, PermissionFlagsBits, type Client, type Guild, type GuildMember } from 'discord.js';
import { Hono, type Context } from 'hono';
import { ARCHIVE_MODES, LOG_CATEGORIES, PLAYER_GROUP_KINDS, LOG_LABELS, getSettings, saveSettings, validateSettings, type ArchiveMode, type BotSettings } from '../botSettings.ts';
import { sendWelcome } from '../events/guildMemberAdd.ts';
import { runAutoClean } from '../lib/autoClean.ts';
import { applyBranding, brandingError } from '../lib/branding.ts';
import { readBotLog } from '../lib/botLog.ts';
import { memberNames } from '../lib/members.ts';
import { refreshStickies } from '../lib/sticky.ts';
import { parseDate, parseTime, toEpochMs } from '../lib/time.ts';
import { syncVoiceRoles } from '../lib/voiceRoles.ts';
import { LOG_COLORS, sendLog, sendTestLogs } from '../logs/send.ts';
import { estimatedMinutes, parsePollFile, questionCount } from '../polls/format.ts';
import { buildResultsCsv } from '../polls/render.ts';
import { MAX_IMAGE_SIZE, PUBLISH_PERMISSIONS, answersByUser, closeAndRedraw, pollStats, publishPoll, savePollUnpublished } from '../polls/service.ts';
import { countResponses, getPollFile, listPolls, listResponses, type StoredPoll } from '../polls/store.ts';
import { attendanceRecords, checkedRaids, summarize } from '../raids/attendanceStats.ts';
import { refreshBoard } from '../raids/board.ts';
import { KINDS, isKind, type ActivityKind, type RoleLimits } from '../raids/kinds.ts';
import { raidFromTemplate } from '../raids/scheduler.ts';
import { RAID_PUBLISH_PERMISSIONS, publishRaid, raidUrl } from '../raids/service.ts';
import { sendRaidToDms } from '../raids/openDm.ts';
import { listRaids } from '../raids/store.ts';
import { settings as constants } from '../settings.ts';
import { sendFarewell } from '../welcome/farewell.ts';
import { sendWelcomeDm, type WelcomeDmResult } from '../welcome/dm.ts';
import { svetaStatus } from '../sveta/index.ts';
import { forgetPerson, getPerson, listPeople, personInput, savePerson, type Person } from '../sveta/memory.ts';
import type * as Api from './apiTypes.ts';
import { readSession, type Session } from './auth.ts';
import { channelName, checkChannel, checkRole, checkVoiceChannel, guildPoll, memberOptions, mentionRoles, messageUrl, roleOptions, textChannels, voiceChannels } from './forms.ts';

type ApiEnv = { Variables: { session: Session; member: GuildMember; guild: Guild } };
type C = Context<ApiEnv>;

const POLL_TEMPLATE = new URL('../../examples/poll-example.txt', import.meta.url);
const MAX_POLL_SOURCE = 200 * 1024;

// --- Чтение значений из JSON: ничего не доверяем, приводим к ожидаемому виду ---
type Json = Record<string, unknown>;
const obj = (value: unknown): Json => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {});
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim() : '');
const id = (value: unknown): string | null => text(value) || null;
const num = (value: unknown): number => (typeof value === 'number' ? value : Number(text(value)));
const bool = (value: unknown): boolean => value === true;

/** Лимиты по ролям из JSON: пусто — без лимита, остальное проверит validateSettings. */
const limitsOf = (value: unknown): RoleLimits => {
  const source = obj(value);
  const one = (v: unknown) => (v === null || v === undefined || v === '' ? null : num(v));
  return { tank: one(source.tank), healer: one(source.healer), dps: one(source.dps) };
};

/** Список ролей без повторов; каждая проверяется по серверу, несуществующие — в ошибки. */
const roleList = (guild: Guild, value: unknown, name: string, errors: string[]): string[] =>
  [...new Set(arr(value).map(id))].map((roleId) => checkRole(guild, roleId, name, errors)).filter((roleId): roleId is string => roleId !== null);

const fail = (c: C, errors: string[], status: 400 | 401 | 403 | 404 = 400) => c.json({ errors: [...new Set(errors)] } satisfies Api.ApiError, status);
const ok = (c: C, message: string) => c.json({ message } satisfies Api.ApiMessage);

/** Настройки в виде ответа API; аннотация заставляет компилятор сверить apiTypes с настоящими типами. */
function settingsJson(s: BotSettings): Api.Settings {
  return s;
}

interface Section {
  /** Название раздела в записи «лог-сервер». */
  label: string;
  apply(next: BotSettings, body: Json, guild: Guild, errors: string[]): void;
  /** Что сделать сразу после сохранения (без ожидания следующего прохода бота). */
  after?(guild: Guild): Promise<unknown>;
}

export function createApi(client: Client<true>, adminGuild: () => Guild | undefined) {
  const api = new Hono<ApiEnv>();

  // Вход и права — на каждом запросе. CSRF — для всего, что меняет данные.
  api.use('*', async (c, next) => {
    const session = await readSession(c);
    if (!session) return fail(c, ['Нужно войти через Discord.'], 401);
    const guild = adminGuild();
    const member = guild ? await guild.members.fetch(session.userId).catch(() => null) : null;
    if (!guild || !member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return fail(c, ['Админка открыта только тем, у кого на сервере есть право «Управлять сервером».'], 403);
    }
    if (c.req.method !== 'GET' && c.req.header('X-CSRF-Token') !== session.csrf) return fail(c, ['Страница устарела — обнови её.'], 403);
    c.set('session', session);
    c.set('member', member);
    c.set('guild', guild);
    return next();
  });

  /** Запись в «лог-сервер»: кто и что сделал в админке. */
  const log = (c: C, title: string, what: string, color: number = LOG_COLORS.update) =>
    sendLog(c.get('guild'), 'server', new EmbedBuilder().setColor(color).setTitle(title).setDescription(`**Кто:** <@${c.get('session').userId}>\n${what}`));

  // --- Кто я, сервер, варианты для списков ---
  api.get('/me', (c) => {
    const session = c.get('session');
    const guild = c.get('guild');
    return c.json({
      user: { id: session.userId, name: session.name, avatar: session.avatar },
      guild: { id: guild.id, name: guild.name, iconUrl: guild.iconURL({ size: 128 }) },
      csrf: session.csrf,
    } satisfies Api.MeResponse);
  });

  api.get('/overview', async (c) => {
    const guild = c.get('guild');
    await client.user.fetch().catch(() => null); // баннер приходит только с полным профилем
    return c.json({
      bot: client.user.tag,
      guild: guild.name,
      members: guild.memberCount,
      ping: client.ws.ping,
      openRaids: listRaids(guild.id, 'open').length,
      polls: listPolls(guild.id).length,
      avatarUrl: client.user.displayAvatarURL({ size: 128 }),
      bannerUrl: client.user.bannerURL({ size: 512 }) ?? null, // Discord принимает только степени двойки
    } satisfies Api.OverviewResponse);
  });

  // --- Лог бота: что бот писал в консоль ---
  api.get('/botlog', (c) => {
    const level = c.req.query('level');
    const before = Number(c.req.query('before'));
    return c.json(
      readBotLog({
        filter: level === 'warn' || level === 'error' ? level : 'all',
        search: c.req.query('q') ?? '',
        before: Number.isInteger(before) && before > 0 ? before : null,
      }) satisfies Api.BotLogResponse,
    );
  });

  api.get('/options', (c) => {
    const guild = c.get('guild');
    return c.json({ textChannels: textChannels(guild), voiceChannels: voiceChannels(guild), roles: roleOptions(guild), mentionRoles: mentionRoles(guild) } satisfies Api.OptionsResponse);
  });

  // Участники-люди — для выбора, например, кому разрешён мат. Всех видно благодаря Server Members Intent.
  api.get('/members', async (c) => {
    const guild = c.get('guild');
    const members = guild.members.cache.size >= guild.memberCount ? guild.members.cache : await guild.members.fetch().catch(() => guild.members.cache);
    return c.json(memberOptions(members.values()) satisfies Api.Option[]);
  });

  api.post('/branding/:part', async (c) => {
    const part = c.req.param('part');
    if (part !== 'avatar' && part !== 'banner') return fail(c, ['Можно обновить только аватар или баннер.'], 404);
    const name = part === 'avatar' ? 'Аватар' : 'Баннер';
    try {
      await applyBranding(client.rest, part);
    } catch (error) {
      return fail(c, [brandingError(error)]);
    }
    await log(c, 'Оформление бота изменено в админке', `**Что:** ${name.toLowerCase()} бота`);
    return ok(c, `${name} бота обновлён. В Discord изменения видны через несколько секунд.`);
  });

  // --- Настройки по разделам ---
  const sections: Record<Api.SettingsSection, Section> = {
    channels: {
      label: 'Каналы и роли',
      apply(next, body, guild, errors) {
        const channels = obj(body.channels);
        const roles = obj(body.roles);
        next.channels = {
          welcome: checkChannel(guild, id(channels.welcome), 'Канал приветствия', errors),
          rules: checkChannel(guild, id(channels.rules), 'Канал правил', errors),
        };
        next.roles = { guest: checkRole(guild, id(roles.guest), 'Роль «Гость»', errors), autorole: checkRole(guild, id(roles.autorole), 'Автороль', errors) };
        next.voiceRoles = [];
        arr(body.voiceRoles).forEach((raw, i) => {
          const link = obj(raw);
          const name = `Голосовая роль ${i + 1}`;
          if (!id(link.channelId) && !id(link.roleId)) return; // пустая строка для новой связки
          if (!id(link.channelId) || !id(link.roleId)) {
            errors.push(`${name}: выбери и голосовой канал, и роль.`);
            return;
          }
          const channelId = checkVoiceChannel(guild, id(link.channelId), name, errors);
          const roleId = checkRole(guild, id(link.roleId), name, errors);
          if (channelId && roleId && !next.voiceRoles.some((l) => l.channelId === channelId && l.roleId === roleId)) next.voiceRoles.push({ channelId, roleId });
        });
      },
      after: (guild) => syncVoiceRoles(guild),
    },
    logs: {
      label: 'Логи',
      apply(next, body, guild, errors) {
        const logs = obj(body.logs);
        for (const category of LOG_CATEGORIES) {
          const entry = obj(logs[category]);
          next.logs[category] = { channelId: checkChannel(guild, id(entry.channelId), `Канал «${LOG_LABELS[category].title}»`, errors), enabled: bool(entry.enabled) };
        }
      },
    },
    alerts: {
      label: 'Оповещения',
      apply(next, body, guild, errors) {
        const alerts = obj(body.alerts);
        const raids = obj(body.raids);
        next.alerts = {
          channelId: checkChannel(guild, id(alerts.channelId), 'Канал оповещений', errors),
          roleId: checkRole(guild, id(alerts.roleId), 'Роль для упоминания', errors),
          lateCancelHours: num(alerts.lateCancelHours),
          incidentChannelId: checkChannel(guild, id(alerts.incidentChannelId), 'Канал инцидентов', errors),
        };
        next.raids.gatherMinutes = num(raids.gatherMinutes);
        next.raids.attendanceMinutes = num(raids.attendanceMinutes);
        next.raids.attendanceVoiceChannelId = checkVoiceChannel(guild, id(raids.attendanceVoiceChannelId), 'Голосовой канал рейда', errors);
      },
    },
    welcome: {
      label: 'Приветствие',
      apply(next, body) {
        const welcome = obj(body.welcome);
        next.welcome = { text: text(welcome.text), guestOffer: text(welcome.guestOffer), guestButton: text(welcome.guestButton), rulesButton: text(welcome.rulesButton) };
      },
    },
    welcomeDm: {
      label: 'Приветствие в личку',
      apply(next, body) {
        const dm = obj(body.welcomeDm);
        next.welcomeDm = { enabled: bool(dm.enabled), text: text(dm.text) };
      },
    },
    farewell: {
      label: 'Прощание',
      apply(next, body, guild, errors) {
        const farewell = obj(body.farewell);
        next.farewell = { channelId: checkChannel(guild, id(farewell.channelId), 'Канал прощаний', errors), text: text(farewell.text) };
      },
    },
    onboarding: {
      label: 'Анкета новичков',
      apply(next, body, guild, errors) {
        const onboarding = obj(body.onboarding);
        let pollId: number | null = null;
        if (onboarding.pollId !== null && onboarding.pollId !== undefined && onboarding.pollId !== '') {
          const poll = guildPoll(guild, String(onboarding.pollId));
          if (!poll) errors.push('Анкета: такого опроса нет на сервере.');
          else if (poll.closed) errors.push('Анкета: опрос закрыт — выбери открытый или «Не предлагать».');
          else pollId = poll.id;
        }
        next.onboarding = {
          pollId,
          offer: text(onboarding.offer),
          button: text(onboarding.button),
          dm: bool(onboarding.dm),
          roleId: checkRole(guild, id(onboarding.roleId), 'Анкета: роль после заполнения', errors),
          removeRoleId: checkRole(guild, id(onboarding.removeRoleId), 'Анкета: роль, которую снять', errors),
          notify: bool(onboarding.notify),
        };
      },
    },
    raids: {
      label: 'Настройки рег',
      apply(next, body, guild, errors) {
        const raids = obj(body.raids);
        const archive = obj(raids.archive);
        const mode = text(archive.mode) as ArchiveMode;
        next.raids = {
          ...next.raids,
          defaultSize: num(raids.defaultSize),
          defaultTime: text(raids.defaultTime),
          tempRoleId: checkRole(guild, id(raids.tempRoleId), 'Временная роль', errors),
          tempRoleHours: num(raids.tempRoleHours),
          archive: {
            mode: ARCHIVE_MODES.includes(mode) ? mode : 'off',
            channelId: checkChannel(guild, id(archive.channelId), 'Канал-архив', errors),
            hours: num(archive.hours),
          },
          boardChannelId: checkChannel(guild, id(raids.boardChannelId), 'Канал со списком рейдов', errors),
          discordEvents: bool(raids.discordEvents),
        };
      },
      after: (guild) => refreshBoard(client, guild.id),
    },
    templates: {
      label: 'Рейды',
      apply(next, body, guild, errors) {
        next.raidTemplates = arr(body.raidTemplates).map((raw, i) => {
          const t = obj(raw);
          return {
            id: id(t.id) ?? `t${Date.now().toString(36)}${i}`,
            title: text(t.title),
            description: text(t.description),
            size: num(t.size),
            time: text(t.time),
            channelId: checkChannel(guild, id(t.channelId), `Шаблон ${i + 1}`, errors),
            pingRoleIds: roleList(guild, t.pingRoleIds, `Шаблон ${i + 1}: роль для упоминания`, errors),
            dmOnOpen: bool(t.dmOnOpen),
            mainRoleIds: roleList(guild, t.mainRoleIds, `Шаблон ${i + 1}: роль основы`, errors),
            reserveRoleIds: roleList(guild, t.reserveRoleIds, `Шаблон ${i + 1}: роль запаса`, errors),
            kind: (text(t.kind) || 'raid') as ActivityKind,
            limits: limitsOf(t.limits),
            slots: arr(t.slots)
              .map(obj)
              .map((slot) => ({ raidDay: num(slot.raidDay), raidTime: text(slot.raidTime), openDay: num(slot.openDay), openTime: text(slot.openTime) }))
              .sort((a, b) => a.raidDay - b.raidDay),
          };
        });
      },
      after: (guild) => refreshBoard(client, guild.id),
    },
    groups: {
      label: 'Группы от игроков',
      apply(next, body, guild, errors) {
        const groups = obj(body.groups);
        for (const kind of PLAYER_GROUP_KINDS) {
          const group = obj(groups[kind]);
          const name = `Группы игроков (${KINDS[kind].title})`;
          next.groups[kind] = {
            channelId: checkChannel(guild, id(group.channelId), `${name}: канал`, errors),
            size: num(group.size),
            limits: limitsOf(group.limits),
            creatorRoleIds: roleList(guild, group.creatorRoleIds, `${name}: роль`, errors),
          };
        }
      },
    },
    sticky: {
      label: 'Липкие сообщения',
      apply(next, body, guild, errors) {
        const sticky = obj(body.sticky);
        next.sticky = {
          intervalSeconds: num(sticky.intervalSeconds),
          items: arr(sticky.items).map((raw, i) => {
            const item = obj(raw);
            return {
              channelId: checkChannel(guild, id(item.channelId), `Липкое сообщение ${i + 1}`, errors) ?? '',
              text: text(item.text),
              roleIds: roleList(guild, item.roleIds, `Липкое сообщение ${i + 1}: роль`, errors),
            };
          }),
        };
      },
      after: (guild) => refreshStickies(guild, true),
    },
    autoclean: {
      label: 'Автоочистка',
      apply(next, body, guild, errors) {
        next.autoClean = arr(body.autoClean).map((raw, i) => {
          const rule = obj(raw);
          return { channelId: checkChannel(guild, id(rule.channelId), `Автоочистка ${i + 1}`, errors) ?? '', hours: num(rule.hours), keepBot: bool(rule.keepBot) };
        });
      },
      after: async () => void runAutoClean(client).catch((error) => console.error('Автоочистка:', error)),
    },
    sveta: {
      label: 'Света',
      apply(next, body, guild, errors) {
        const sveta = obj(body.sveta);
        const channelIds = arr(sveta.channelIds)
          .map((raw, i) => checkChannel(guild, id(raw), `Света: канал ${i + 1}`, errors))
          .filter((channelId): channelId is string => channelId !== null);
        next.sveta = {
          enabled: bool(sveta.enabled),
          channelIds: [...new Set(channelIds)],
          newsChannelId: checkChannel(guild, id(sveta.newsChannelId), 'Света: канал новостей о сборах', errors),
          persona: text(sveta.persona),
          model: text(sveta.model),
          fallbackModel: text(sveta.fallbackModel),
          randomPercent: num(sveta.randomPercent),
          userCooldownSeconds: num(sveta.userCooldownSeconds),
          perHour: num(sveta.perHour),
          perDay: num(sveta.perDay),
          // Пустые строки формы отбрасываем; имена — через запятую, без пробелов по краям и без повторов.
          lore: arr(sveta.lore)
            .map((raw) => {
              const entry = obj(raw);
              return { names: [...new Set(arr(entry.names).map(text).filter(Boolean))], story: text(entry.story) };
            })
            .filter((entry) => entry.names.length || entry.story),
        };
      },
    },
    profanity: {
      label: 'Фильтр мата',
      apply(next, body, guild, errors) {
        const profanity = obj(body.profanity);
        const channelIds = arr(profanity.ignoredChannelIds)
          .map((raw, i) => checkChannel(guild, id(raw), `Фильтр мата: канал-исключение ${i + 1}`, errors))
          .filter((channelId): channelId is string => channelId !== null);
        next.profanity = {
          enabled: bool(profanity.enabled),
          level: text(profanity.level) as BotSettings['profanity']['level'],
          action: text(profanity.action) as BotSettings['profanity']['action'],
          strikesToMute: num(profanity.strikesToMute),
          strikeWindowMinutes: num(profanity.strikeWindowMinutes),
          muteMinutes: num(profanity.muteMinutes),
          warningSeconds: num(profanity.warningSeconds),
          ignoredChannelIds: [...new Set(channelIds)],
          // Кто ушёл с сервера, остаётся в списке: вернётся — право при нём; админка покажет «нет на сервере».
          allowedUserIds: [...new Set(arr(profanity.allowedUserIds).map(id).filter((userId): userId is string => userId !== null))],
          scoldMinutes: num(profanity.scoldMinutes),
          // Свои слова — в нижнем регистре, без пустых и повторов.
          extraWords: [...new Set(arr(profanity.extraWords).map((word) => text(word).toLowerCase()).filter(Boolean))],
        };
      },
    },
  };

  api.get('/settings', (c) => c.json(settingsJson(getSettings())));
  api.get('/sveta/status', (c) => c.json(svetaStatus(c.get('guild').id) satisfies Api.SvetaStatus));

  // --- Память Светы о людях: посмотреть, поправить, стереть ---
  const personJson = ({ userId, name, attitude, nickname, notes, updatedAt }: Person): Api.SvetaPerson => ({ userId, name, attitude, nickname, notes, updatedAt });
  api.get('/sveta/people', (c) => c.json(listPeople(c.get('guild').id).map(personJson)));
  api.put('/sveta/people/:user{[0-9]+}', async (c) => {
    const person = getPerson(c.get('guild').id, c.req.param('user'));
    if (!person) return fail(c, ['Света об этом человеке ничего не помнит.'], 404);
    const input = personInput(obj(await c.req.json().catch(() => null)));
    if (input.errors.length) return fail(c, input.errors);
    const now = Date.now();
    // У заметок, которые не меняли, остаётся их дата.
    const notes = input.notes.map((text) => ({ at: person.notes.find((n) => n.text === text)?.at ?? now, text }));
    savePerson({ ...person, attitude: input.attitude, nickname: input.nickname, notes, updatedAt: now });
    await log(c, 'Память Светы изменена в админке', `**О ком:** ${person.name} (<@${person.userId}>)`);
    return c.json(personJson(getPerson(person.guildId, person.userId)!));
  });
  api.delete('/sveta/people/:user{[0-9]+}', async (c) => {
    const person = getPerson(c.get('guild').id, c.req.param('user'));
    if (!person || !forgetPerson(person.guildId, person.userId)) return fail(c, ['Света об этом человеке ничего не помнит.'], 404);
    await log(c, 'Память Светы стёрта в админке', `**О ком:** ${person.name} (<@${person.userId}>)`, LOG_COLORS.delete);
    return ok(c, `Память Светы стёрта: ${person.name}.`);
  });

  api.put('/settings/:section', async (c) => {
    const section = sections[c.req.param('section') as Api.SettingsSection];
    if (!section) return fail(c, ['Такого раздела настроек нет.'], 404);
    const body = obj(await c.req.json().catch(() => null));
    const guild = c.get('guild');
    const next = structuredClone(getSettings());
    const errors: string[] = [];
    section.apply(next, body, guild, errors);
    errors.push(...validateSettings(next));
    if (errors.length) return fail(c, errors);
    saveSettings(next);
    await log(c, 'Настройки бота изменены в админке', `**Раздел:** ${section.label}`);
    await section.after?.(guild).catch((error) => console.error(`${section.label}:`, error));
    return c.json(settingsJson(next));
  });

  // --- Пробные отправки ---
  api.post('/logs/test', async (c) => {
    const sent = await sendTestLogs(c.get('guild'), `<@${c.get('session').userId}>`);
    return sent.length ? ok(c, `Тестовое сообщение отправлено в каналов: ${sent.length}.`) : fail(c, ['Ни один лог-канал не выбран или не включён.']);
  });
  api.post('/welcome/test', async (c) =>
    (await sendWelcome(c.get('member'))) ? ok(c, 'Пробное приветствие отправлено в канал приветствия.') : fail(c, ['Канал приветствия не выбран или боту туда нельзя писать.']),
  );
  api.post('/welcome/dm/test', async (c) => {
    const result = await sendWelcomeDm(c.get('member'), true);
    const failures: Partial<Record<WelcomeDmResult, string>> = {
      closed: 'Не получилось: у тебя закрыты личные сообщения от участников сервера (ПКМ по иконке сервера → Настройки конфиденциальности).',
      failed: 'Не получилось отправить — подробности в консоли бота.',
    };
    return result === 'sent' ? ok(c, 'Пробное приветствие отправлено тебе в личку.') : fail(c, [failures[result] ?? 'Не получилось отправить.']);
  });
  api.post('/farewell/test', async (c) =>
    (await sendFarewell(c.get('member'))) ? ok(c, 'Пробное прощание отправлено в канал прощаний.') : fail(c, ['Канал прощаний не выбран или боту туда нельзя писать.']),
  );

  // --- Опросы ---
  api.get('/polls', (c) => {
    const guild = c.get('guild');
    const rows = listPolls(guild.id, 100).map((poll) => ({
      id: poll.id,
      title: poll.definition.title,
      channel: channelName(guild, poll.channelId),
      closed: poll.closed,
      ...countResponses(poll.id),
      createdAt: poll.createdAt,
      url: messageUrl(poll),
      onboarding: getSettings().onboarding.pollId === poll.id,
    }));
    return c.json(rows satisfies Api.PollRow[]);
  });

  api.get('/polls/template', async (c) =>
    c.json({ source: (await readFile(POLL_TEMPLATE, 'utf8')).replace(/\r\n/g, '\n'), channelId: null, roleId: null } satisfies Api.PollSourceResponse),
  );

  api.post('/polls/check', async (c) => {
    const body = obj(await c.req.json().catch(() => null));
    return c.json(checkPoll(typeof body.source === 'string' ? body.source.replace(/\r\n/g, '\n') : ''));
  });

  api.post('/polls', async (c) => {
    const guild = c.get('guild');
    const form = await c.req.parseBody();
    const source = typeof form.source === 'string' ? form.source.replace(/\r\n/g, '\n') : '';
    if (source.length > MAX_POLL_SOURCE) return fail(c, ['Текст опроса слишком длинный (больше 200 КБ).']);
    const parsed = parsePollFile(source);
    if (!parsed.ok) return fail(c, parsed.errors);

    // «Сохранить без публикации»: ни канала, ни сообщения — такой опрос проходят из приветствия и лички (анкета новичков).
    if (form.publish === '0') {
      if (form.image instanceof File && form.image.size > 0) {
        return fail(c, ['Картинка-файл показывается в сообщении опроса в канале — без публикации её некуда прикрепить. Убери её или опубликуй опрос.']);
      }
      const poll = savePollUnpublished(guild.id, parsed.poll, c.get('session').userId, source);
      await logPoll(c, 'Опрос сохранён без публикации', poll, LOG_COLORS.create);
      return c.json({ id: poll.id });
    }

    const errors: string[] = [];
    const channelId = checkChannel(guild, id(form.channel), 'Канал опроса', errors);
    if (!channelId && !errors.length) errors.push('Выбери канал, куда опубликовать опрос.');
    const roleId = checkRole(guild, id(form.role), 'Роль для упоминания', errors);
    const image = form.image instanceof File && form.image.size > 0 ? form.image : null;
    if (image && (!image.type.startsWith('image/') || image.size > MAX_IMAGE_SIZE)) errors.push('Картинка должна быть изображением до 8 МБ.');
    const channel = channelId ? guild.channels.cache.get(channelId) : undefined;
    const me = guild.members.me;
    if (channel?.isTextBased() && me && !channel.permissionsFor(me)?.has(PUBLISH_PERMISSIONS)) {
      errors.push(`В #${channel.name} боту нужны права: видеть канал, отправлять сообщения и прикреплять файлы.`);
    }
    if (errors.length || !channel?.isTextBased()) return fail(c, errors.length ? errors : ['Канал недоступен.']);

    try {
      const { poll } = await publishPoll(channel, parsed.poll, c.get('session').userId, {
        ...(image ? { image: { data: Buffer.from(await image.arrayBuffer()), fileName: image.name } } : {}),
        ...(roleId ? { mentionRoleId: roleId } : {}),
        source,
      });
      await logPoll(c, 'Опрос опубликован через админку', poll, LOG_COLORS.create);
      return c.json({ id: poll.id });
    } catch (error) {
      console.error('Не удалось опубликовать опрос из админки:', error);
      return fail(c, ['Discord не принял сообщение — подробности в консоли бота.']);
    }
  });

  api.get('/polls/:id{[0-9]+}', async (c) => {
    const guild = c.get('guild');
    const poll = guildPoll(guild, c.req.param('id'));
    if (!poll) return fail(c, ['Опрос не найден.'], 404);
    const responses = listResponses(poll.id);
    const stats = pollStats(poll, responses);
    const anonymous = poll.definition.anonymous;
    const people = anonymous ? [] : [...new Set(responses.map((r) => r.userId))];
    const names = people.length ? await memberNames(guild, people) : new Map<string, string>();
    const respondents = anonymous
      ? null
      : answersByUser(poll, responses).map((person) => ({
          name: names.get(person.userId) ?? `ушёл с сервера (ID ${person.userId})`,
          completed: person.completed,
          updatedAt: person.updatedAt,
          answers: person.answers,
        }));
    return c.json({
      info: {
        id: poll.id,
        title: poll.definition.title,
        channel: channelName(guild, poll.channelId),
        url: messageUrl(poll),
        closed: poll.closed,
        anonymous,
        canCopy: poll.source !== null,
        onboarding: getSettings().onboarding.pollId === poll.id,
      },
      stats,
      names: Object.fromEntries(names),
      respondents,
    } satisfies Api.PollResultsResponse);
  });

  // Картинка-ответ. Тип — только PNG/JPG/GIF/WEBP (проверен при загрузке); CSP и nosniff — на всякий случай.
  api.get('/polls/:id{[0-9]+}/files/:file{[0-9]+}', (c) => {
    const poll = guildPoll(c.get('guild'), c.req.param('id'));
    const file = poll ? getPollFile(Number(c.req.param('file'))) : null;
    if (!poll || !file || file.pollId !== poll.id) return fail(c, ['Картинка не найдена.'], 404);
    return c.body(Buffer.from(file.data), 200, {
      'Content-Type': file.contentType,
      'Cache-Control': 'private, max-age=86400',
      'Content-Security-Policy': "default-src 'none'",
      'X-Content-Type-Options': 'nosniff',
    });
  });

  api.get('/polls/:id{[0-9]+}/source', (c) => {
    const poll = guildPoll(c.get('guild'), c.req.param('id'));
    if (!poll?.source) return fail(c, ['У этого опроса нет сохранённого текста.'], 404);
    return c.json({ source: poll.source, channelId: poll.channelId, roleId: poll.definition.mentionRoleId ?? null } satisfies Api.PollSourceResponse);
  });

  api.get('/polls/:id{[0-9]+}/csv', async (c) => {
    const guild = c.get('guild');
    const poll = guildPoll(guild, c.req.param('id'));
    if (!poll) return fail(c, ['Опрос не найден.'], 404);
    const responses = listResponses(poll.id);
    const names = poll.definition.anonymous ? new Map<string, string>() : await memberNames(guild, responses.map((r) => r.userId));
    return c.body(buildResultsCsv(poll, responses, names), 200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="poll-${poll.id}.csv"`,
    });
  });

  api.post('/polls/:id{[0-9]+}/close', async (c) => {
    const guild = c.get('guild');
    const poll = guildPoll(guild, c.req.param('id'));
    if (!poll) return fail(c, ['Опрос не найден.'], 404);
    if (poll.closed) return ok(c, 'Опрос уже закрыт.');
    await closeAndRedraw(guild, poll);
    await logPoll(c, 'Опрос закрыт через админку', poll, LOG_COLORS.delete);
    return ok(c, 'Опрос закрыт: новые ответы больше не принимаются.');
  });

  const logPoll = (c: C, title: string, poll: StoredPoll, color: number) =>
    log(c, title, `**Опрос:** #${poll.id} «${poll.definition.title}»\n**Канал:** ${poll.channelId ? `<#${poll.channelId}>` : 'без публикации'}`, color);

  // --- Посещаемость ---
  api.get('/attendance', async (c) => {
    const guild = c.get('guild');
    const today = Temporal.Now.plainDateISO(constants.timeZone);
    const from = parseDate(c.req.query('from') ?? '', today) ?? today.subtract({ days: 30 });
    const to = parseDate(c.req.query('to') ?? '', today) ?? today;
    const start = toEpochMs(from, Temporal.PlainTime.from('00:00'));
    const end = toEpochMs(to.add({ days: 1 }), Temporal.PlainTime.from('00:00')); // «по» — включительно
    const kindQuery = c.req.query('kind');
    const kind = isKind(kindQuery) ? kindQuery : undefined;
    const summary = summarize(attendanceRecords(guild.id, start, end, undefined, kind));
    const names = summary.length ? await memberNames(guild, summary.map((row) => row.userId)) : new Map<string, string>();
    return c.json({
      from: from.toString(),
      to: to.toString(),
      checked: checkedRaids(guild.id, start, end, kind),
      rows: summary.map((row) => ({ ...row, name: names.get(row.userId) ?? `ушёл с сервера (ID ${row.userId})` })),
    } satisfies Api.AttendanceResponse);
  });

  // --- Создать регу из шаблона ---
  api.post('/templates/:id/create', async (c) => {
    const guild = c.get('guild');
    const body = obj(await c.req.json().catch(() => null));
    const template = getSettings().raidTemplates.find((t) => t.id === c.req.param('id'));
    if (!template) return fail(c, ['Шаблон не найден.'], 404);

    const date = parseDate(text(body.date));
    const startTime = parseTime(text(body.time) || template.time);
    if (!date) return fail(c, ['Выбери дату реги.']);
    if (!startTime) return fail(c, ['Время в формате ЧЧ:ММ, например 20:00.']);
    const startsAt = toEpochMs(date, startTime);
    if (startsAt <= Date.now()) return fail(c, ['Это время уже прошло — выбери будущее.']);
    const channel = template.channelId ? guild.channels.cache.get(template.channelId) : undefined;
    if (!channel?.isTextBased() || channel.isDMBased()) return fail(c, [`Канал шаблона «${template.title}» недоступен — выбери другой в шаблоне.`]);
    const me = guild.members.me;
    if (me && !channel.permissionsFor(me)?.has(RAID_PUBLISH_PERMISSIONS)) {
      return fail(c, [`В #${channel.name} боту нужны права: видеть канал, отправлять сообщения, встраивать ссылки и прикреплять файлы.`]);
    }
    try {
      const raid = await publishRaid(
        channel,
        raidFromTemplate(template, { startsAt, createdBy: c.get('session').userId, leaderName: c.get('member').displayName }),
        template.pingRoleIds,
      );
      await log(c, 'Рега создана через админку', `**Рега:** #${raid.id} «${raid.title}» по шаблону\n**Канал:** <#${raid.channelId}>`, LOG_COLORS.create);
      if (template.dmOnOpen) void sendRaidToDms(guild, raid, template.pingRoleIds);
      return c.json({ message: `Рега #${raid.id} «${raid.title}» создана в #${channel.name}.`, url: raidUrl(raid) } satisfies Api.TemplateCreateResponse);
    } catch (error) {
      console.error('Не удалось создать регу из админки:', error);
      return fail(c, ['Discord не принял сообщение реги — подробности в консоли бота.']);
    }
  });

  return api;
}

/** Разбор текста опроса: ошибки по строкам или то, как бот понял опрос. */
function checkPoll(source: string): Api.PollCheckResponse {
  if (source.length > MAX_POLL_SOURCE) return { errors: ['Текст опроса слишком длинный (больше 200 КБ).'], preview: null, minutes: null, questions: null };
  const parsed = parsePollFile(source);
  if (!parsed.ok) return { errors: parsed.errors, preview: null, minutes: null, questions: null };
  return { errors: [], preview: parsed.poll, minutes: estimatedMinutes(parsed.poll), questions: questionCount(parsed.poll) };
}
