// Страницы админки. Чистые функции «данные → HTML»: не знают про Discord, поэтому их легко проверить.
// `html` из hono сам экранирует подставленные строки — названия каналов и тексты безопасны.
import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import { LOG_CATEGORIES, LOG_LABELS, type ArchiveMode, type BotSettings, type RaidSchedule, type RaidTemplate } from '../botSettings.ts';
import { estimatedMinutes, questionCount, type PollDefinition, type QuestionKind } from '../polls/format.ts';
import type { PollStats } from '../polls/service.ts';

type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

export interface Option {
  id: string;
  name: string;
  /** Подзаголовок группы в списке (категория канала). */
  group?: string;
  /** Предупреждение рядом с выбором (например, роль выше роли бота). */
  warning?: string;
}

export interface PageContext {
  user: { name: string; avatar: string | null };
  csrf: string;
  active: 'home' | 'channels' | 'logs' | 'alerts' | 'welcome' | 'polls' | 'raids' | 'templates' | 'sticky' | 'autoclean';
  notice?: string;
  errors?: string[];
}

const NAV: [PageContext['active'], string, string][] = [
  ['home', '/', 'Главная'],
  ['channels', '/channels', 'Каналы и роли'],
  ['logs', '/logs', 'Логи'],
  ['alerts', '/alerts', 'Оповещения'],
  ['welcome', '/welcome', 'Приветствие'],
  ['polls', '/polls', 'Опросы'],
  ['raids', '/raids', 'Расписание рег'],
  ['templates', '/templates', 'Шаблоны рег'],
  ['sticky', '/sticky', 'Липкие сообщения'],
  ['autoclean', '/autoclean', 'Автоочистка'],
];

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const ARCHIVE_LABELS: [ArchiveMode, string][] = [
  ['off', 'Не трогать прошедшие реги'],
  ['move', 'Переносить в канал-архив (итог + финальный состав)'],
  ['delete', 'Удалять и оставлять краткий итог в канале реги'],
];

const STYLE = html`<style>
  :root { --bg:#0f1220; --panel:#181c2e; --line:#2a3050; --text:#e6e8f0; --muted:#9aa1b9; --gold:#d4a73c; --blue:#5865f2; --red:#e5484d; --green:#3fb950; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:15px/1.5 "Segoe UI", system-ui, sans-serif; }
  header { display:flex; align-items:center; gap:14px; padding:12px 24px; background:var(--panel); border-bottom:1px solid var(--line); flex-wrap:wrap; }
  header img { width:44px; height:44px; border-radius:8px; }
  header b { font-size:17px; color:var(--gold); }
  nav { display:flex; gap:4px; flex-wrap:wrap; flex:1; }
  nav a { color:var(--muted); text-decoration:none; padding:6px 12px; border-radius:6px; }
  nav a.on, nav a:hover { color:var(--text); background:#232842; }
  .user { display:flex; align-items:center; gap:8px; color:var(--muted); }
  .user img { width:28px; height:28px; border-radius:50%; }
  main { max-width:880px; margin:0 auto; padding:24px 16px 64px; }
  h1 { font-size:22px; margin:0 0 4px; } p.lead { color:var(--muted); margin:0 0 20px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:16px 18px; margin-bottom:16px; }
  label { display:block; font-weight:600; margin:12px 0 4px; } .hint { color:var(--muted); font-size:13px; font-weight:400; }
  select, input[type=text], input[type=number], input[type=time], textarea { width:100%; background:#0f1220; color:var(--text); border:1px solid var(--line); border-radius:6px; padding:8px 10px; font:inherit; }
  textarea { min-height:110px; resize:vertical; }
  .row { display:grid; grid-template-columns: 1fr 1fr; gap:12px; } @media (max-width:640px){ .row { grid-template-columns:1fr; } }
  .days { display:flex; gap:10px; flex-wrap:wrap; } .days label, .check { display:inline-flex; align-items:center; gap:6px; font-weight:400; margin:0; }
  button { background:var(--blue); color:#fff; border:0; border-radius:6px; padding:9px 16px; font:inherit; font-weight:600; cursor:pointer; }
  button.secondary { background:#2b3150; } button.danger { background:var(--red); }
  .actions { display:flex; gap:10px; flex-wrap:wrap; margin-top:16px; }
  .notice { border-left:4px solid var(--green); } .errors { border-left:4px solid var(--red); } .errors li { margin:2px 0; }
  .warn { color:var(--gold); font-size:13px; }
  .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:12px; } .stat b { display:block; font-size:22px; }
  .login { max-width:420px; margin:80px auto; text-align:center; } .login img { width:160px; border-radius:16px; }
  code { background:#232842; padding:1px 5px; border-radius:4px; }
  textarea.code { font:13px/1.5 Consolas, "Cascadia Mono", monospace; min-height:440px; tab-size:2; }
  table { width:100%; border-collapse:collapse; } th, td { text-align:left; padding:7px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { color:var(--muted); font-size:13px; font-weight:600; } tr:last-child td { border-bottom:0; }
  a.link, td a, .errors a { color:#8ea1ff; }
  .tag { font-size:12px; padding:1px 8px; border-radius:10px; background:#2b3150; color:var(--muted); white-space:nowrap; } .tag.open { background:#1f3b2a; color:var(--green); }
  .opt { display:grid; grid-template-columns:minmax(0,1fr) 180px 90px; gap:10px; align-items:center; margin:6px 0; } @media (max-width:640px){ .opt { grid-template-columns:1fr 90px; } .opt .bar { display:none; } }
  .bar { background:#232842; border-radius:4px; height:10px; overflow:hidden; } .bar i { display:block; height:100%; background:var(--gold); }
  .num { color:var(--muted); font-size:13px; text-align:right; white-space:nowrap; }
  ul.answers { margin:8px 0 0; padding-left:18px; } ul.answers li { margin:4px 0; white-space:pre-wrap; }
  .tabs { display:flex; gap:6px; margin:0 0 16px; } .tabs a { padding:7px 14px; border-radius:6px; background:#232842; color:var(--muted); text-decoration:none; } .tabs a.on { background:var(--blue); color:#fff; }
  details.person { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:10px 16px; margin-bottom:10px; } details.person summary { cursor:pointer; font-weight:600; }
  details.person dl { margin:8px 0 0; } details.person dt { color:var(--muted); font-size:13px; margin-top:8px; } details.person dd { margin:2px 0 0; white-space:pre-wrap; }
  .preview ol { padding-left:20px; } .preview li { margin:6px 0; } .preview ul { color:var(--muted); margin:4px 0; }
</style>`;

function layout(title: string, ctx: PageContext | null, body: Html): Html {
  return html`<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · The Last Hope</title>${STYLE}</head>
<body>
${ctx
  ? html`<header>
      <img src="/logo.jpg" alt=""><b>The Last Hope</b>
      <nav>${NAV.map(([key, href, label]) => html`<a href="${href}" class="${ctx.active === key ? 'on' : ''}">${label}</a>`)}</nav>
      <span class="user">${ctx.user.avatar ? html`<img src="${ctx.user.avatar}" alt="">` : ''}${ctx.user.name} · <a href="/logout" style="color:var(--muted)">Выйти</a></span>
    </header>`
  : ''}
<main>
${ctx?.notice ? html`<div class="card notice">${ctx.notice}</div>` : ''}
${ctx?.errors?.length ? html`<div class="card errors"><b>Не сохранено:</b><ul>${ctx.errors.map((e) => html`<li>${e}</li>`)}</ul></div>` : ''}
${body}
</main>
</body>
</html>`;
}

function csrfField(ctx: PageContext): Html {
  return html`<input type="hidden" name="_csrf" value="${ctx.csrf}">`;
}

/** Выпадающий список каналов или ролей с вариантом «— не выбрано —» и группами по категориям. */
function select(name: string, options: Option[], selected: string | null, emptyLabel = '— не выбрано —'): Html {
  const groups = new Map<string, Option[]>();
  for (const option of options) {
    const key = option.group ?? '';
    groups.set(key, [...(groups.get(key) ?? []), option]);
  }
  const optionTags = (list: Option[]) =>
    list.map((o) => html`<option value="${o.id}" ${o.id === selected ? 'selected' : ''}>${o.name}</option>`);
  return html`<select name="${name}">
    <option value="">${emptyLabel}</option>
    ${[...groups.entries()].map(([group, list]) => (group ? html`<optgroup label="${group}">${optionTags(list)}</optgroup>` : optionTags(list)))}
  </select>
  ${(() => {
    const warning = options.find((o) => o.id === selected)?.warning;
    return warning ? html`<div class="warn">⚠ ${warning}</div>` : '';
  })()}`;
}

export function loginPage(message?: string): Html {
  return layout(
    'Вход',
    null,
    html`<div class="login card">
      <img src="/logo.jpg" alt="The Last Hope">
      <h1>Админка бота</h1>
      <p class="lead">Вход для администраторов сервера через Discord.</p>
      ${message ? html`<p class="warn">${message}</p>` : ''}
      <a href="/login"><button type="button">Войти через Discord</button></a>
    </div>`,
  );
}

export interface HomeStats {
  bot: string;
  guild: string;
  members: number;
  ping: number;
  openRaids: number;
  polls: number;
  avatarUrl: string;
  bannerUrl: string | null;
}

export function homePage(ctx: PageContext, stats: HomeStats): Html {
  return layout(
    'Главная',
    ctx,
    html`<h1>Бот ${stats.bot}</h1>
    <p class="lead">Сервер «${stats.guild}». Изменения в настройках действуют сразу, перезапуск не нужен.</p>
    <div class="card stats">
      <div class="stat"><span class="hint">Участников</span><b>${stats.members}</b></div>
      <div class="stat"><span class="hint">Задержка Discord</span><b>${stats.ping >= 0 ? `${stats.ping} мс` : '—'}</b></div>
      <div class="stat"><span class="hint">Открытых рег</span><b>${stats.openRaids}</b></div>
      <div class="stat"><span class="hint">Опросов</span><b>${stats.polls}</b></div>
    </div>
    <form method="post" class="card">${csrfField(ctx)}
      <h3 style="margin:0 0 8px">Оформление бота</h3>
      <div style="display:flex; gap:16px; align-items:center; flex-wrap:wrap">
        <img src="${stats.avatarUrl}" alt="Аватар" style="width:72px; height:72px; border-radius:50%">
        ${stats.bannerUrl
          ? html`<img src="${stats.bannerUrl}" alt="Баннер" style="height:72px; border-radius:8px; max-width:100%">`
          : html`<span class="hint">Баннер не задан</span>`}
      </div>
      <p class="hint">Аватар берётся из <code>assets/bot-avatar.png</code> или <code>logo.jpg</code>, баннер — из <code>assets/bot-banner.png</code> (лучше широкий, 680×240) или <code>logo.jpg</code>. Discord разрешает менять их не слишком часто.</p>
      <div class="actions">
        <button formaction="/branding/avatar">Обновить аватар</button>
        <button class="secondary" formaction="/branding/banner">Обновить баннер</button>
      </div>
    </form>`,
  );
}

export function channelsPage(ctx: PageContext, s: BotSettings, channels: Option[], roles: Option[], voiceChannels: Option[]): Html {
  // Существующие связки + одна пустая строка для новой.
  const rows = [...s.voiceRoles, { channelId: '', roleId: '' }];
  return layout(
    'Каналы и роли',
    ctx,
    html`<h1>Каналы и роли</h1>
    <p class="lead">Где бот приветствует новичков и какие роли выдаёт.</p>
    <form method="post" class="card">${csrfField(ctx)}
      <label>Канал приветствия <span class="hint">— сюда бот пишет, когда кто-то заходит на сервер</span></label>
      ${select('welcome', channels, s.channels.welcome)}
      <div class="row">
        <div><label>Канал правил <span class="hint">— ссылка и кнопка «Правила»</span></label>${select('rules', channels, s.channels.rules)}</div>
        <div><label>Канал авторизации <span class="hint">— ссылка в приветствии</span></label>${select('auth', channels, s.channels.auth)}</div>
      </div>
      <div class="row">
        <div><label>Роль «Гость» <span class="hint">— по кнопке в приветствии</span></label>${select('guest', roles, s.roles.guest)}</div>
        <div><label>Автороль <span class="hint">— выдаётся каждому новичку сразу</span></label>${select('autorole', roles, s.roles.autorole)}</div>
      </div>
      <h3 style="margin:20px 0 0">Голосовые роли</h3>
      <p class="hint">Пока участник сидит в голосовом канале, у него есть роль; вышел — роль снимается. Удобно, чтобы открыть текстовый канал рейда только тем, кто в голосовом. Последняя строка — для новой связки.</p>
      <input type="hidden" name="vrCount" value="${rows.length}">
      ${rows.map(
        (link, i) => html`<div class="row" style="align-items:end">
          <div><label>Голосовой канал</label>${select(`vr${i}_channel`, voiceChannels, link.channelId || null)}</div>
          <div><label>Роль</label>${select(`vr${i}_role`, roles, link.roleId || null)}
            ${link.channelId ? html`<label class="check" style="margin-top:6px"><input type="checkbox" name="vr${i}_delete"> удалить связку</label>` : ''}</div>
        </div>`,
      )}
      <div class="actions"><button>Сохранить</button></div>
    </form>`,
  );
}

export function logsPage(ctx: PageContext, s: BotSettings, channels: Option[]): Html {
  return layout(
    'Логи',
    ctx,
    html`<h1>Логи</h1>
    <p class="lead">В какой канал бот пишет каждый вид событий. Сними галочку, чтобы временно выключить лог.</p>
    <form method="post" class="card">${csrfField(ctx)}
      ${LOG_CATEGORIES.map(
        (category) => html`<div class="row" style="align-items:end">
          <div><label>${LOG_LABELS[category].title} <span class="hint">— ${LOG_LABELS[category].hint}</span></label>
            ${select(`${category}_channel`, channels, s.logs[category].channelId)}</div>
          <div><label class="check"><input type="checkbox" name="${category}_enabled" ${s.logs[category].enabled ? 'checked' : ''}> включено</label></div>
        </div>`,
      )}
      <div class="actions">
        <button>Сохранить</button>
        <button class="secondary" formaction="/logs/test">Отправить тестовое сообщение в лог-каналы</button>
      </div>
    </form>
    <p class="hint">Для «лог-сервер» и «лог-модерация» у роли бота должно быть право «Просматривать журнал аудита».</p>`,
  );
}

export function welcomePage(ctx: PageContext, s: BotSettings, channels: Option[]): Html {
  return layout(
    'Приветствие',
    ctx,
    html`<h1>Приветствие</h1>
    <p class="lead">Подстановки: <code>{user}</code> — новичок, <code>{server}</code> — сервер, <code>{rules}</code> и <code>{auth}</code> — каналы, <code>{role}</code> — роль «Гость». Работает разметка Discord: <code>**жирный**</code>, эмодзи.</p>
    <form method="post" class="card">${csrfField(ctx)}
      <label>Текст приветствия</label><textarea name="text">${s.welcome.text}</textarea>
      <label>Предложение роли «Гость» <span class="hint">— показывается, если роль выбрана</span></label><textarea name="guestOffer" style="min-height:60px">${s.welcome.guestOffer}</textarea>
      <div class="row">
        <div><label>Кнопка роли</label><input type="text" name="guestButton" value="${s.welcome.guestButton}"></div>
        <div><label>Кнопка правил</label><input type="text" name="rulesButton" value="${s.welcome.rulesButton}"></div>
      </div>
      <div class="actions">
        <button>Сохранить</button>
        <button class="secondary" formaction="/welcome/test">Прислать пробное приветствие (с тобой в роли новичка)</button>
      </div>
    </form>
    <h1 style="margin-top:28px">Приветствие в личку</h1>
    <p class="lead">Кроме приветствия в канале, бот может написать новичку в личные сообщения: памятку и кнопки-ссылки на правила и авторизацию. Подстановки: <code>{name}</code> — имя, <code>{user}</code> — упоминание, <code>{server}</code> — сервер, <code>{rules}</code>, <code>{auth}</code>, <code>{welcome}</code> — каналы правил, авторизации и приветствия, <code>{role}</code> — роль «Гость». Если у новичка закрыта личка, бот просто пропустит его.</p>
    <form method="post" action="/welcome/dm" class="card">${csrfField(ctx)}
      <label class="check"><input type="checkbox" name="dmEnabled" ${s.welcomeDm.enabled ? 'checked' : ''}> присылать новичкам в личку</label>
      <label>Текст</label><textarea name="dmText" style="min-height:150px">${s.welcomeDm.text}</textarea>
      <div class="actions">
        <button>Сохранить</button>
        <button class="secondary" formaction="/welcome/dm/test">Прислать пробное тебе в личку</button>
      </div>
      <p class="hint">Пробное сообщение приходит с сохранённым текстом, даже если галочка снята.</p>
    </form>
    <h1 style="margin-top:28px">Прощание</h1>
    <p class="lead">Когда участник уходит с сервера, бот пишет в выбранный канал. Подстановки: <code>{user}</code> — упоминание, <code>{name}</code> — имя, <code>{server}</code> — сервер, <code>{members}</code> — сколько осталось участников.</p>
    <form method="post" action="/farewell" class="card">${csrfField(ctx)}
      <label>Канал прощаний <span class="hint">— без выбора прощания не публикуются</span></label>
      ${select('farewellChannel', channels, s.farewell.channelId)}
      <label>Текст прощания</label><textarea name="farewellText" style="min-height:70px">${s.farewell.text}</textarea>
      <div class="actions">
        <button>Сохранить</button>
        <button class="secondary" formaction="/farewell/test">Прислать пробное прощание (с тобой в роли ушедшего)</button>
      </div>
    </form>`,
  );
}

export function alertsPage(ctx: PageContext, s: BotSettings, channels: Option[], voiceChannels: Option[], roles: Option[]): Html {
  return layout(
    'Оповещения',
    ctx,
    html`<h1>Оповещения</h1>
    <p class="lead">Что бот сообщает офицерам и игрокам вокруг рейдов. 0 в поле минут или часов — выключить.</p>
    <form method="post">${csrfField(ctx)}
      <div class="card">
        <h3 style="margin:0">Офицерам</h3>
        <div class="row">
          <div><label>Канал оповещений <span class="hint">— посещаемость, поздние отписки</span></label>${select('alertsChannel', channels, s.alerts.channelId)}</div>
          <div><label>Кого упоминать <span class="hint">— например, @Офицер</span></label>${select('alertsRole', roles, s.alerts.roleId, '— никого —')}</div>
        </div>
        <label>Поздняя отписка — меньше чем за столько часов до рейда</label>
        <input type="number" name="lateCancelHours" min="0" max="72" value="${s.alerts.lateCancelHours}">
      </div>
      <div class="card">
        <h3 style="margin:0">Модераторам</h3>
        <label>Канал инцидентов <span class="hint">— мат, вход совсем нового аккаунта, массовые упоминания; карточка с кнопками «Мут 1 ч», «Бан», «Пропустить»</span></label>
        ${select('incidentChannel', channels, s.alerts.incidentChannelId, '— не присылать —')}
      </div>
      <div class="card">
        <h3 style="margin:0">Рейды</h3>
        <div class="row">
          <div><label>«Сбор!» в канале реги — за сколько минут до начала</label><input type="number" name="gatherMinutes" min="0" max="120" value="${s.raids.gatherMinutes}"></div>
          <div><label>Проверка посещаемости — через сколько минут после начала</label><input type="number" name="attendanceMinutes" min="0" max="180" value="${s.raids.attendanceMinutes}"></div>
        </div>
        <label>Голосовой канал рейда <span class="hint">— кого считать пришедшими; без выбора — любой голосовой канал</span></label>
        ${select('attendanceVoice', voiceChannels, s.raids.attendanceVoiceChannelId, '— любой голосовой —')}
      </div>
      <div class="actions"><button>Сохранить</button></div>
    </form>
    <p class="hint">Чтобы упоминание роли офицеров дошло, роль должна быть упоминаемой (настройки роли → «Разрешить всем @упоминать эту роль»).</p>`,
  );
}

function scheduleCard(index: number, schedule: RaidSchedule, channels: Option[], roles: Option[]): Html {
  const p = `s${index}`;
  return html`<div class="card">
    <input type="hidden" name="${p}_id" value="${schedule.id}">
    <div class="row">
      <div><label>Название реги</label><input type="text" name="${p}_title" value="${schedule.title}"></div>
      <div><label>Канал</label>${select(`${p}_channel`, channels, schedule.channelId, '— выключено —')}</div>
    </div>
    <label>Дни открытия реги</label>
    <div class="days">${DAYS.map(
      (day, i) => html`<label><input type="checkbox" name="${p}_days" value="${i + 1}" ${schedule.days.includes(i + 1) ? 'checked' : ''}> ${day}</label>`,
    )}</div>
    <div class="row">
      <div><label>Время открытия <span class="hint">(по Киеву)</span></label><input type="time" name="${p}_openAt" value="${schedule.openAt}"></div>
      <div><label>Время рейда</label><input type="time" name="${p}_raidTime" value="${schedule.raidTime}"></div>
    </div>
    <div class="row">
      <div><label>Рейд через сколько дней после открытия <span class="hint">— 0: в тот же день</span></label>
        <input type="number" name="${p}_offset" min="0" max="14" value="${schedule.raidDayOffset}"></div>
      <div><label>Упомянуть роль при открытии</label>${select(`${p}_ping`, roles, schedule.pingRoleId, '— никого —')}</div>
    </div>
    <div class="actions"><label class="check"><input type="checkbox" name="${p}_delete"> удалить это расписание</label></div>
  </div>`;
}

export function raidsPage(ctx: PageContext, s: BotSettings, channels: Option[], roles: Option[]): Html {
  return layout(
    'Расписание рег',
    ctx,
    html`<h1>Расписание рег</h1>
    <p class="lead">Бот сам открывает реги в выбранные дни и время. Без канала расписание не работает.</p>
    <form method="post">${csrfField(ctx)}
      <div class="card row">
        <div><label>Мест в основном составе <span class="hint">— по умолчанию</span></label><input type="number" name="defaultSize" min="1" max="100" value="${s.raids.defaultSize}"></div>
        <div><label>Время рейда по умолчанию <span class="hint">— для /raid quick и кнопок в личке</span></label><input type="time" name="defaultTime" value="${s.raids.defaultTime}"></div>
      </div>
      <div class="card row">
        <div><label>Временная роль участникам <span class="hint">— выдаётся при записи</span></label>${select('tempRole', roles, s.raids.tempRoleId, '— не выдавать —')}</div>
        <div><label>Снимать через (часов после начала)</label><input type="number" name="tempRoleHours" min="1" max="48" value="${s.raids.tempRoleHours}"></div>
      </div>
      <div class="card">
        <label>Живой список ближайших рейдов <span class="hint">— одно сообщение со всеми открытыми регами, бот обновляет его сам</span></label>
        ${select('boardChannel', channels, s.raids.boardChannelId, '— не показывать —')}
        <div class="actions"><label class="check"><input type="checkbox" name="discordEvents" ${s.raids.discordEvents ? 'checked' : ''}> создавать для каждой реги событие Discord (вкладка «События» сервера; боту нужно право «Создавать события»)</label></div>
      </div>
      <div class="card">
        <label>Архив прошедших рег</label>
        <select name="archiveMode">
          ${ARCHIVE_LABELS.map(([mode, label]) => html`<option value="${mode}" ${s.raids.archive.mode === mode ? 'selected' : ''}>${label}</option>`)}
        </select>
        <div class="row">
          <div><label>Канал-архив <span class="hint">— для переноса</span></label>${select('archiveChannel', channels, s.raids.archive.channelId)}</div>
          <div><label>Через сколько часов после начала</label><input type="number" name="archiveHours" min="1" max="72" value="${s.raids.archive.hours}"></div>
        </div>
      </div>
      <input type="hidden" name="count" value="${s.raids.schedules.length}">
      ${s.raids.schedules.map((schedule, index) => scheduleCard(index, schedule, channels, roles))}
      <div class="actions">
        <button>Сохранить</button>
        <button class="secondary" formaction="/raids/add">Добавить расписание</button>
      </div>
    </form>`,
  );
}

export function stickyPage(ctx: PageContext, s: BotSettings, channels: Option[]): Html {
  const rows = [...s.sticky.items, { channelId: '', text: '' }];
  return layout(
    'Липкие сообщения',
    ctx,
    html`<h1>Липкие сообщения</h1>
    <p class="lead">Текст, который всегда остаётся последним в канале: после новых сообщений бот удаляет прошлую копию и публикует его заново внизу. Подходит для правил рег, ЛФГ или важных объявлений. Последняя строка — для нового.</p>
    <form method="post">${csrfField(ctx)}
      <div class="card">
        <label>Переставлять не чаще раза в (секунд)</label>
        <input type="number" name="interval" min="5" max="600" value="${s.sticky.intervalSeconds}">
      </div>
      <input type="hidden" name="count" value="${rows.length}">
      ${rows.map(
        (item, i) => html`<div class="card">
          <label>Канал</label>${select(`st${i}_channel`, channels, item.channelId || null)}
          <label>Текст <span class="hint">— разметка Discord работает</span></label><textarea name="st${i}_text" style="min-height:70px">${item.text}</textarea>
          ${item.channelId ? html`<div class="actions"><label class="check"><input type="checkbox" name="st${i}_delete"> убрать из этого канала</label></div>` : ''}
        </div>`,
      )}
      <div class="actions"><button>Сохранить</button></div>
    </form>`,
  );
}

// --- Шаблоны рег ---

export function templatesPage(ctx: PageContext, s: BotSettings, channels: Option[], roles: Option[], today: string): Html {
  const rows: RaidTemplate[] = [...s.raidTemplates, { id: '', title: '', description: '', size: s.raids.defaultSize, time: s.raids.defaultTime, channelId: null, pingRoleId: null }];
  const name = (list: Option[], id: string | null) => list.find((o) => o.id === id)?.name ?? '—';
  return layout(
    'Шаблоны рег',
    ctx,
    html`<h1>Шаблоны рег</h1>
    <p class="lead">Заготовки для типовых рейдов: выбери дату — и рега готова, без ввода названия и описания каждый раз.</p>
    ${s.raidTemplates.length
      ? s.raidTemplates.map(
          (t) => html`<form method="post" action="/templates/${t.id}/create" class="card">${csrfField(ctx)}
            <b>${t.title}</b> <span class="hint">— ${t.size} мест · ${name(channels, t.channelId)}${t.pingRoleId ? html` · пинг @${name(roles, t.pingRoleId)}` : ''}</span>
            <div class="row">
              <div><label>Дата</label><input type="date" name="date" value="${today}" min="${today}"></div>
              <div><label>Время</label><input type="time" name="time" value="${t.time}"></div>
            </div>
            <div class="actions"><button>Создать регу</button></div>
          </form>`,
        )
      : html`<div class="card">Шаблонов пока нет — заполни форму ниже.</div>`}
    <h1 style="margin-top:28px">Редактировать шаблоны</h1>
    <p class="lead">Последняя карточка — для нового шаблона.</p>
    <form method="post" action="/templates">${csrfField(ctx)}
      <input type="hidden" name="count" value="${rows.length}">
      ${rows.map(
        (t, i) => html`<div class="card">
          <input type="hidden" name="t${i}_id" value="${t.id}">
          <div class="row">
            <div><label>Название${t.id ? '' : html` <span class="hint">— новый шаблон</span>`}</label><input type="text" name="t${i}_title" maxlength="100" value="${t.title}"></div>
            <div><label>Канал</label>${select(`t${i}_channel`, channels, t.channelId)}</div>
          </div>
          <label>Описание <span class="hint">— сбор, требования; можно оставить пустым</span></label><textarea name="t${i}_description" style="min-height:60px">${t.description}</textarea>
          <div class="row">
            <div><label>Мест в составе</label><input type="number" name="t${i}_size" min="1" max="100" value="${t.size}"></div>
            <div><label>Время начала</label><input type="time" name="t${i}_time" value="${t.time}"></div>
          </div>
          <label>Упомянуть роль <span class="hint">— необязательно</span></label>${select(`t${i}_ping`, roles, t.pingRoleId, '— никого —')}
          ${t.id ? html`<div class="actions"><label class="check"><input type="checkbox" name="t${i}_delete"> удалить шаблон</label></div>` : ''}
        </div>`,
      )}
      <div class="actions"><button>Сохранить шаблоны</button></div>
    </form>`,
  );
}

// --- Опросы ---

export interface PollRow {
  id: number;
  title: string;
  channel: string;
  closed: boolean;
  total: number;
  completed: number;
  createdAt: string;
  url: string | null;
}

export function pollsPage(ctx: PageContext, rows: PollRow[]): Html {
  return layout(
    'Опросы',
    ctx,
    html`<h1>Опросы</h1>
    <p class="lead">Опросы на несколько страниц с условиями — то же, что <code>/poll create</code>, только в браузере: написать, проверить, опубликовать, смотреть итоги.</p>
    <div class="actions" style="margin:0 0 16px"><a href="/polls/new"><button type="button">Новый опрос</button></a></div>
    ${rows.length
      ? html`<div class="card"><table>
          <tr><th>#</th><th>Опрос</th><th>Канал</th><th>Ответы</th><th>Статус</th><th>Создан</th></tr>
          ${rows.map(
            (row) => html`<tr>
              <td>${row.id}</td>
              <td><a href="/polls/${row.id}">${row.title}</a></td>
              <td>${row.url ? html`<a href="${row.url}" target="_blank" rel="noopener">${row.channel}</a>` : row.channel}</td>
              <td>${row.completed}${row.total > row.completed ? html` <span class="hint">+${row.total - row.completed} не закончили</span>` : ''}</td>
              <td>${row.closed ? html`<span class="tag">закрыт</span>` : html`<span class="tag open">открыт</span>`}</td>
              <td class="hint">${row.createdAt}</td>
            </tr>`,
          )}
        </table></div>`
      : html`<div class="card">Опросов пока нет. Нажми «Новый опрос» — откроется шаблон с подсказками.</div>`}`,
  );
}

export interface PollForm {
  source: string;
  channelId: string | null;
  roleId: string | null;
  /** Черновик в браузере: restore — подставить сохранённый, reset — забыть, keep — не трогать. */
  draft: 'restore' | 'reset' | 'keep';
}

export interface PollEditorResult {
  /** Ошибки в тексте опроса («Строка N: …»). */
  errors?: string[];
  /** Почему не получилось опубликовать (канал, картинка, права). */
  publishErrors?: string[];
  preview?: PollDefinition;
}

const KIND_LABELS: Record<QuestionKind, string> = {
  single: 'один вариант',
  multiple: 'несколько вариантов',
  short: 'короткий ответ текстом',
  paragraph: 'длинный ответ текстом',
};

export function pollEditorPage(ctx: PageContext, form: PollForm, channels: Option[], roles: Option[], result: PollEditorResult): Html {
  const lineOf = (error: string) => /^Строка (\d+)/.exec(error)?.[1] ?? '';
  return layout(
    'Новый опрос',
    ctx,
    html`<p><a class="link" href="/polls">← Все опросы</a></p>
    <h1>Новый опрос</h1>
    <p class="lead">Опрос пишется текстом: <code>#</code> — заголовок, <code>##</code> — страница (до 5 вопросов), <code>###</code> — вопрос (<code>*</code> в конце — обязательный), <code>( )</code> — один вариант, <code>[ ]</code> — несколько, <code>Ответ: короткий</code> — ответ текстом, <code>Если: Вопрос = Вариант</code> — страница по условию. Строки с <code>//</code> — подсказки, бот их пропускает. «Проверить» покажет, как бот понял опрос.</p>
    ${result.errors?.length
      ? html`<div class="card errors"><b>Ошибки в тексте опроса</b> <span class="hint">— нажми на ошибку, чтобы перейти к строке</span>
          <ul>${result.errors.map((error) => html`<li><a href="#" data-line="${lineOf(error)}">${error}</a></li>`)}</ul></div>`
      : ''}
    ${result.publishErrors?.length
      ? html`<div class="card errors"><b>Не опубликовано:</b><ul>${result.publishErrors.map((error) => html`<li>${error}</li>`)}</ul></div>`
      : ''}
    <form method="post" action="/polls/new" enctype="multipart/form-data">${csrfField(ctx)}
      <div class="card">
        <label>Текст опроса <span class="hint">— черновик сохраняется в браузере, пока не опубликуешь</span></label>
        <textarea name="source" class="code" spellcheck="false" data-draft="${form.draft}">${form.source}</textarea>
      </div>
      <div class="card">
        <div class="row">
          <div><label>Канал</label>${select('channel', channels, form.channelId)}</div>
          <div><label>Упомянуть роль <span class="hint">— необязательно</span></label>${select('role', roles, form.roleId, '— никого —')}</div>
        </div>
        <label>Картинка <span class="hint">— файл до 8 МБ, выбери перед публикацией; или строка «Картинка: ссылка» в тексте</span></label>
        <input type="file" name="image" accept="image/*">
        <div class="actions">
          <button name="action" value="check" class="secondary">Проверить</button>
          <button name="action" value="publish" onclick="return confirm('Опубликовать опрос в выбранный канал?')">Опубликовать</button>
          <a href="/polls/new?fresh=1"><button type="button" class="secondary" onclick="return confirm('Заменить текст шаблоном? Черновик пропадёт.')">Начать с шаблона</button></a>
        </div>
      </div>
    </form>
    ${result.preview ? pollPreview(result.preview) : ''}
    <script>
    (() => {
      const area = document.querySelector('textarea[name=source]');
      const key = 'tlh-poll-draft';
      const storage = {
        get() { try { return localStorage.getItem(key); } catch { return null; } },
        set(value) { try { localStorage.setItem(key, value); } catch {} },
        clear() { try { localStorage.removeItem(key); } catch {} },
      };
      if (area.dataset.draft === 'restore') { const saved = storage.get(); if (saved) area.value = saved; }
      if (area.dataset.draft === 'reset') storage.clear();
      area.addEventListener('input', () => storage.set(area.value));
      // Клик по ошибке — выделить нужную строку в тексте.
      document.querySelectorAll('[data-line]').forEach((link) => link.addEventListener('click', (event) => {
        event.preventDefault();
        const line = Number(link.dataset.line);
        if (!line) return;
        const lines = area.value.split('\\n');
        let start = 0;
        for (let i = 0; i < line - 1 && i < lines.length; i++) start += lines[i].length + 1;
        area.focus();
        area.setSelectionRange(start, start + (lines[line - 1] || '').length);
        area.scrollTop = Math.max(0, line - 4) * (parseFloat(getComputedStyle(area).lineHeight) || 20);
      }));
    })();
    </script>`,
  );
}

/** Как бот понял опрос: страницы, условия, вопросы и варианты. */
function pollPreview(poll: PollDefinition): Html {
  const questions = poll.blocks.flatMap((block) => block.questions);
  const describe = (questionId: string, value: string, negate: boolean) => {
    const question = questions.find((q) => q.id === questionId);
    const option = question?.options.find((o) => o.value === value);
    return html`«${question?.title ?? questionId}» ${negate ? '≠' : '='} «${option?.label ?? value}»`;
  };
  return html`<h1 style="margin-top:28px">Предпросмотр</h1>
    <p class="lead">Ошибок нет. Так бот понял опрос — проверь и жми «Опубликовать».</p>
    <div class="card preview">
      <b style="font-size:18px">${poll.title}</b>
      ${poll.description ? html`<p style="white-space:pre-wrap">${poll.description}</p>` : ''}
      ${poll.image && /^https?:\/\//.test(poll.image) ? html`<img src="${poll.image}" alt="" style="max-width:100%; border-radius:8px">` : ''}
      <div class="hint">Кнопка «${poll.button}» · страниц: ${poll.blocks.length} · вопросов: ${questionCount(poll)} · примерно ${estimatedMinutes(poll)} мин · ${poll.anonymous ? 'анонимный — офицеры увидят только статистику' : 'офицеры увидят, кто как ответил'}</div>
    </div>
    ${poll.blocks.map(
      (block, index) => html`<div class="card preview">
        <b>Страница ${index + 1}. ${block.title}</b>
        ${block.conditions.length
          ? html`<div class="warn">Показывается, только если ${block.conditions.map((c, i) => html`${i ? ' и ' : ''}${describe(c.questionId, c.optionValue, c.negate)}`)}</div>`
          : ''}
        ${block.intro ? html`<p class="hint" style="white-space:pre-wrap">${block.intro}</p>` : ''}
        <ol>
          ${block.questions.map(
            (q) => html`<li><b>${q.title}</b>${q.required ? html` <span class="warn">*</span>` : ''} <span class="hint">— ${KIND_LABELS[q.kind]}</span>
              ${q.hint ? html`<div class="hint">${q.hint}</div>` : ''}
              ${q.options.length
                ? html`<ul>${q.options.map((o) => html`<li>${o.label}${o.description ? html` <span class="hint">— ${o.description}</span>` : ''}</li>`)}</ul>`
                : ''}</li>`,
          )}
        </ol>
      </div>`,
    )}`;
}

export interface PollResultsInfo {
  id: number;
  title: string;
  channel: string;
  url: string | null;
  closed: boolean;
  anonymous: boolean;
  canCopy: boolean;
  /** Только что опубликован — забыть черновик в браузере. */
  published: boolean;
}

/** Один человек на вкладке «По участникам». */
export interface RespondentView {
  name: string;
  completed: boolean;
  when: string;
  answers: { block: string; question: string; answer: string }[];
}

export function pollResultsPage(
  ctx: PageContext,
  info: PollResultsInfo,
  stats: PollStats,
  names: Map<string, string>,
  view: 'stats' | 'users' = 'stats',
  respondents: RespondentView[] = [],
): Html {
  const shownTexts = 100;
  return layout(
    info.title,
    ctx,
    html`<p><a class="link" href="/polls">← Все опросы</a></p>
    <h1>${info.title}</h1>
    <p class="lead">Опрос #${info.id} · ${info.channel} · ${info.closed ? 'закрыт' : 'открыт'} · ${info.anonymous ? 'анонимный' : 'с именами'}${info.url ? html` · <a class="link" href="${info.url}" target="_blank" rel="noopener">открыть в Discord</a>` : ''}</p>
    <div class="stats">
      <div class="card stat"><b>${stats.completed}</b>завершили</div>
      <div class="card stat"><b>${stats.total - stats.completed}</b>начали, но не закончили</div>
    </div>
    <div class="actions" style="margin:0 0 16px">
      <a href="/polls/${info.id}/csv"><button type="button" class="secondary">Скачать таблицу для Excel</button></a>
      ${info.canCopy ? html`<a href="/polls/new?from=${info.id}"><button type="button" class="secondary">Создать копию</button></a>` : ''}
      ${info.closed
        ? ''
        : html`<form method="post" action="/polls/${info.id}/close" style="margin:0" onsubmit="return confirm('Закрыть опрос? Новые ответы перестанут приниматься.')">${csrfField(ctx)}<button class="danger">Закрыть опрос</button></form>`}
    </div>
    <nav class="tabs">
      <a href="/polls/${info.id}" class="${view === 'stats' ? 'on' : ''}">Общая статистика</a>
      <a href="/polls/${info.id}?view=users" class="${view === 'users' ? 'on' : ''}">По участникам (${stats.total})</a>
    </nav>
    ${view === 'users' ? respondentsSection(info, respondents) : ''}
    ${view !== 'stats' ? '' : stats.questions.map(
      (q, index) => html`${index === 0 || stats.questions[index - 1]!.block !== q.block ? html`<h1 style="margin-top:24px; font-size:18px">${q.block}</h1>` : ''}
      <div class="card">
        <b>${q.title}</b> <span class="hint">— ответили: ${q.answered}</span>
        ${q.options.map(
          (o) => html`<div class="opt"><div>${o.label}</div><div class="bar"><i style="width:${o.percent}%"></i></div><div class="num">${o.percent}% · ${o.count}</div></div>`,
        )}
        ${q.kind === 'short' || q.kind === 'paragraph'
          ? q.texts.length
            ? html`<ul class="answers">${q.texts.slice(0, shownTexts).map(
                (t) => html`<li>${t.userId ? html`<b>${names.get(t.userId) ?? 'ушёл с сервера'}:</b> ` : ''}${t.text}</li>`,
              )}</ul>${q.texts.length > shownTexts ? html`<div class="hint">…ещё ${q.texts.length - shownTexts} — в таблице.</div>` : ''}`
            : html`<div class="hint">Ответов пока нет.</div>`
          : ''}
      </div>`,
    )}
    ${info.published ? html`<script>try { localStorage.removeItem('tlh-poll-draft'); } catch {}</script>` : ''}`,
  );
}

function respondentsSection(info: PollResultsInfo, respondents: RespondentView[]): Html {
  if (info.anonymous) return html`<div class="card">Опрос анонимный — ответы по участникам не показываются. Общая статистика — на соседней вкладке.</div>`;
  if (!respondents.length) return html`<div class="card">Ответов пока нет.</div>`;
  return html`<p class="hint">Нажми на имя, чтобы раскрыть ответы. Сначала те, кто дошёл до конца, внутри — свежие сверху.</p>
    ${respondents.map(
      (person, index) => html`<details class="person" ${index < 3 ? 'open' : ''}>
        <summary>${person.name} <span class="hint">— ${person.completed ? 'опрос пройден' : 'опрос не закончен'} · ${person.when} · ответов: ${person.answers.length}</span></summary>
        ${person.answers.length
          ? html`<dl>${person.answers.map(
              (a, i) => html`${i === 0 || person.answers[i - 1]!.block !== a.block ? html`<dt style="color:var(--gold); margin-top:12px">${a.block}</dt>` : ''}<dt>${a.question}</dt><dd>${a.answer}</dd>`,
            )}</dl>`
          : html`<div class="hint">Ответов на вопросы пока нет.</div>`}
      </details>`,
    )}`;
}

export function autoCleanPage(ctx: PageContext, s: BotSettings, channels: Option[]): Html {
  const rows = [...s.autoClean, { channelId: '', hours: 24, keepBot: true }];
  return layout(
    'Автоочистка',
    ctx,
    html`<h1>Автоочистка каналов</h1>
    <p class="lead">Бот раз в 10 минут удаляет в выбранных каналах сообщения старше указанного срока — например, во флуде или ЛФГ. Закреплённые сообщения не трогает никогда. Сообщения старше 14 дней Discord не даёт удалять пачкой — их бот убирает по одному, понемногу за проход. Вместо записи на каждое сообщение в «лог-сообщения» приходит одна сводка. Последняя строка — для нового канала.</p>
    <form method="post">${csrfField(ctx)}
      <input type="hidden" name="count" value="${rows.length}">
      ${rows.map(
        (rule, i) => html`<div class="card">
          <div class="row">
            <div><label>Канал</label>${select(`ac${i}_channel`, channels, rule.channelId || null)}</div>
            <div><label>Удалять сообщения старше (часов)</label><input type="number" name="ac${i}_hours" min="1" max="720" value="${rule.hours}"></div>
          </div>
          <div class="actions">
            <label class="check"><input type="checkbox" name="ac${i}_keepBot" ${rule.keepBot ? 'checked' : ''}> не трогать сообщения бота (реги, опросы, закрепы)</label>
            ${rule.channelId ? html`<label class="check"><input type="checkbox" name="ac${i}_delete"> убрать правило</label>` : ''}
          </div>
        </div>`,
      )}
      <div class="actions"><button>Сохранить</button></div>
    </form>`,
  );
}

export function deniedPage(): Html {
  return layout(
    'Нет доступа',
    null,
    html`<div class="login card">
      <img src="/logo.jpg" alt="">
      <h1>Нет доступа</h1>
      <p class="lead">Админка открыта только тем, у кого на сервере есть право «Управлять сервером».</p>
      <a href="/logout"><button type="button" class="secondary">Войти другим аккаунтом</button></a>
    </div>`,
  );
}
