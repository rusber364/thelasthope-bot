# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Discord bot for the WoW Forever guild **The Last Hope** (Alliance). The owner communicates in Russian; all user-facing bot text and docs are Russian.

## Commands

```bash
pnpm install          # pnpm only (packageManager is pinned); workspace = bot (root) + admin-ui
pnpm build            # build the admin UI into admin-ui/dist (vp build) — the bot itself has no build
pnpm dev              # node --watch, restarts on src changes; reads .env only at startup
pnpm start
pnpm deploy           # register slash commands in Discord (this script shadows pnpm's built-in `deploy`)
pnpm test             # node --test "src/**/*.test.ts"
pnpm typecheck        # tsc, type-check only (noEmit) — bot code in src/
pnpm dev:admin        # admin UI dev server on :5173 (vp dev), proxies /api /login /auth /logout to the bot on :3000
pnpm check:admin      # vp check in admin-ui: oxfmt + oxlint + type check
```

Single test file / single test:

```bash
node --test src/lib/profanity.test.ts
node --test --test-name-pattern="ловит" src/lib/profanity.test.ts
```

Tasks are tracked with Backlog.md, installed as a dev dependency — run it as `pnpm backlog …` (plain `backlog` is not on PATH). In Git Bash set `MSYS_NO_PATHCONV=1` when an argument starts with `/` (e.g. `--ac '/raid …'`), otherwise MSYS rewrites it into a Windows path. Task text is in Russian.

The bot has no build step and no linter. Only `admin-ui/` is built (Vite+, `vp` CLI from the `vite-plus` dev dependency; `vite`/`vitest` are pnpm overrides to Vite+ core in `pnpm-workspace.yaml`). `pnpm deploy` must be re-run whenever a command's `data` (name, options, permissions) changes. With `GUILD_ID` set it registers guild commands and clears global ones; it needs the bot already invited to that guild (otherwise `Missing Access`).

## Runtime constraints

- Node 26+ runs `.ts` directly via type stripping. Consequences enforced by `tsconfig.json`: relative imports use the `.ts` extension, `import type` for types (`verbatimModuleSyntax`), and only erasable syntax (`erasableSyntaxOnly`: no enums, namespaces, parameter properties).
- Uses Node built-ins instead of deps: `node:sqlite` (`DatabaseSync`) and the global `Temporal` (typed via `lib: esnext.temporal`). Runtime deps: discord.js 14, `hono` + `@hono/node-server` (admin panel).
- `src/config.ts` reads `.env` (token, guild, admin OAuth secrets). `config.token` is a lazy getter so tests can import modules without a `.env`.
- Settings are split: **`src/botSettings.ts`** holds everything editable from the admin panel (channels, roles, welcome texts, raid templates with schedules, log channels) as one JSON row in the `settings` table, merged as defaults ← `.env` IDs ← DB. Always read via `getSettings()` at call time (never cache at module load) so admin changes apply without restart. **`src/settings.ts`** holds non-editable constants (timezone `Europe/Kyiv`, profanity filter).
- `BOT_DB_PATH` overrides the DB path; tests set it to `:memory:` (and other env vars) *before* dynamically importing modules — see `src/botSettings.test.ts`, `src/admin/api.test.ts`.

## Architecture

**Interaction routing.** `src/events/interactionCreate.ts` dispatches:
- slash commands → `commandsByName` from `src/commands/index.ts`. Each command implements `Command` (`src/types.ts`) and receives `ChatInputCommandInteraction<'cached'>`; all commands are guild-only.
- buttons / selects / modals → by `customId` prefix. `customId` format is `<prefix>:<action>:<args…>`; `src/components.ts` maps prefixes (`role`, `welcome`, `raid`, `poll`) to `ComponentHandler`s. All state needed by a component lives in its `customId` + SQLite, so components keep working across restarts.
- Discord requires a response within 3 s: handlers reply/update first, then do slow work (e.g. redrawing a raid message).

**Persistence.** `src/db.ts` creates `data/bot.db` (gitignored) with `CREATE TABLE IF NOT EXISTS` plus `addColumn(...)` for migrating older DBs — add new columns there, not only in the CREATE statement. Row ↔ object mapping is in `src/raids/store.ts` and `src/polls/store.ts`.

**Raids (`src/raids/`).**
- `classes.ts`: classes/specs/roles. `ROLE_ORDER` (tank, melee, ranged, healer) drives the embed column layout — Discord places 3 inline fields per row, so healers land under tanks.
- `emojis.ts`: class/spec/UI icons are Discord *application emojis* named `wf_<id>` / `wf_ui_<key>`, auto-uploaded from wowhead (`wow.zamimg.com`) by `ensureAppEmojis` on ready. Role icons (tank/healer/melee) and leader are the in-game round LFG icons from `assets/role-icons/*.png` (cut from `Interface/LFGFrame/UI-LFG-ICON-ROLES`), uploaded as `wf_lfg_<file>`; an app emoji's image can't be changed, so a new picture needs a new file name. Use `specEmoji` / `classEmoji` / `uiEmoji` — raid UI must use these WoW icons, not Unicode emoji.
- `render.ts`: Raid-Helper-style **embed** (not Components V2, because columns need inline fields). Optional banner `assets/raid-banner.*` is a separate image-only embed; on every edit the file is re-uploaded with `attachments: []`. Signup number = position by `created_at`; bench/tentative are computed at render time, not stored. Signup is Raid-Helper-style role buttons `raid:role:<id>:<role>` → ephemeral select of that role's specs from all classes (`handlers.ts::specMenuOptions`) → `raid:spec`. Messages still carrying the old class select (`raid:class`) are redrawn once on ready (`service.ts::refreshOutdatedRaids`).
- `service.ts`: `publishRaid`, `refreshRaidMessage` (coalesces concurrent redraws). Raid messages created by older versions as Components V2 cannot be converted to embeds, so they are reposted and the old message deleted.
- `wizard.ts` + `drafts.ts`: `/raid create` is a Raid-Helper-style DM wizard (title → description → date → time → image → preview/publish). State lives in `raid_drafts` (one per user, 2 h TTL), buttons use prefix `rwiz` and are routed from DMs (non-guild interactions) in `interactionCreate`; DM text arrives via `MessageCreate` (needs `DirectMessages` intent + `Partials.Channel`). Each user's answers are processed sequentially (`inQueue`), and a button only acts if it belongs to the draft's latest prompt. A custom image is stored in `raid_images` and re-attached on every redraw instead of the shared banner. `/raid quick` is the old one-command create.
- `board.ts`: optional live «Ближайшие рейды» message (`settings.raids.boardChannelId`, message id in `raid_boards`). `publishRaid` and every `refreshRaidMessage` call `requestBoardRefresh` (1.5 s debounce, serialized per guild); `refreshBoard` also runs on ready and after saving the admin raids page.
- `events.ts`: `syncRaidEvent` mirrors a raid into an EXTERNAL guild scheduled event (location = raid link, end = start + 3 h, Discord auto-completes it; id in `raids.event_id`). Called on publish, `/raid cancel`, `/raid move` (reschedule: `setRaidStart` also resets reminder flags) and when the scheduler closes a started raid — not on every signup. Needs the bot's `CreateEvents` permission; toggle `settings.raids.discordEvents`.
- `personalReminders.ts`: «Напомнить» button → ephemeral select (10/30/60/120 min), stored in `raid_personal_reminders`, sent by the scheduler tick; `setRaidStart` resets them.
- `scheduler.ts`: opens raids from template slots at the start of every minute (`msToNextMinute`, own no-overlap loop; `slots.ts::dueOpenings`; idempotent via unique `schedule_key = <templateId>:<raid date>`, with a catch-up window); a separate 30 s tick sends DM reminders (flags `reminded_day`/`reminded_hour` are set *before* sending, and `raid_signups.reminded` marks who got one; `sendLateReminders` DMs signups that joined after the general reminder 15 min before start), closes started raids.

**Polls (`src/polls/`).** Polls are authored as a Russian text file (`examples/poll-example.txt`) parsed by `format.ts` into a `PollDefinition` stored as JSON: `#` title, `##` block = one modal page (≤ 5 components incl. intro text), `###` question (`*` = required), `( )` single / `[ ]` multiple / `Ответ: короткий|длинный`, `Если: Вопрос = Вариант` (`!=`) conditions that may only reference earlier blocks, header lines `Финал: …` (repeatable, joined with newlines) = `finish` text shown on the completed progress card. `Ответ: картинка` = kind `image`: a modal File Upload (max 1); `handlers.ts::submitBlock` defers, checks type (PNG/JPG/GIF/WEBP only — no SVG, the admin serves them) and size (8 MB), downloads it and stores bytes in `poll_files` (Discord attachment URLs expire); the answer value is the file id. Admin serves it at `GET /api/polls/:id/files/:fileId` (CSP `default-src 'none'`, nosniff); CSV gets that URL; the onboarding card attaches it. `render.ts` picks the component (≤ 10 options → radio/checkbox group, else string select). Modals can't open from a modal submit, so an ephemeral Components V2 "progress card" with a «Продолжить» button sits between pages. Results: embed + CSV (UTF-8 BOM, `;` separator for Russian Excel). `service.ts` holds publish / close+redraw / member names / `pollStats`, shared by `/poll` and the admin «Опросы» pages (editor with check + preview, multipart image upload, results, CSV, copy). The original text is stored in `polls.source` so the admin can copy a poll.

**Onboarding questionnaire.** `settings.onboarding` (admin «Приветствие» → «Анкета»; «Сделать анкетой новичков» on a poll page) points at an open poll. `buildWelcome` then adds `onboarding.offer` and a `poll:start:<id>` button — the regular poll flow, which works from any message. With `onboarding.dm` (default on) `welcome/dm.ts::buildWelcomeDm` puts the same offer and button into the welcome DM, or sends them alone when the welcome DM is off. Poll interactions from DMs are routed in `interactionCreate` to `polls/handlers.ts::handlePollInteraction`, which requires the user to still be a member of the poll's guild (`memberOf`) and uses that member for the onboarding roles/card. `polls/handlers.ts::submitBlock` calls `polls/onboarding.ts::onOnboardingCompleted` when a response *becomes* completed for that poll (after replying to the player): gives `roleId`, removes `removeRoleId`, and with `notify` posts the answers card via `sendAlert` (no answers for anonymous polls). Members already on the server take it from a normal poll publication. `PollRow` / poll results carry `onboarding: boolean`.

**Bot log.** `lib/botLog.ts::captureConsole()` (called first in `src/index.ts`) mirrors every `console.log/info/warn/error` into the `bot_log` table (last 5000 rows, ANSI stripped) plus a `start` marker per launch and `uncaughtExceptionMonitor` crashes; shard disconnect/reconnect/resume are logged from `index.ts`. Admin page «Лог бота» reads it via `GET /api/botlog` (`readBotLog`: level filter, case-insensitive search in JS, `before` paging). Log through `console.*` — nothing else is needed.

**Logs (`src/logs/`).** `sendLog(guild, category, embed)` routes to the channel configured for `members | server | messages | voice | moderation`. Sources: member join/leave, message delete/update/bulk (needs `Partials.Message`; profanity-filter deletions are skipped via `markDeletedByBot`), voice channel changes, and `guildAuditLogEntryCreate` — the only event that tells *who* acted. `formatAuditEntry` (pure, tested) maps audit actions to `server` or `moderation` and drops entries whose executor is the bot itself. `lib/modlog.ts::logModAction` (used by moderation commands) writes to `moderation`. Requires intents `GuildVoiceStates`, `GuildModeration`, `GuildInvites` and the bot's `ViewAuditLog` permission. Invite attribution (`logs/invites.ts`) diffs invite `uses` counters, which Discord only exposes with `ManageGuild`.

**Attendance stats.** `raids/attendanceStats.ts` joins `raid_attendance` with `raid_signups.tentative` (so «под вопросом» shows up as `tentativePresent`/`tentativeAbsent`); `summarize` is pure, rate = present / (present + absent). Used by `/history` and the admin page «Посещаемость». `lib/members.ts::memberNames` resolves names for polls and stats.

**Moderation incidents.** `logs/incidents.ts` posts a card with «Мут 1 ч / Бан / Пропустить» buttons (prefix `incident`) to `settings.alerts.incidentChannelId` for profanity deletions (called from the filter), accounts younger than 3 days joining, and mass mentions. `actionProblem` checks the clicker's permission and role hierarchy; ban needs a second ephemeral confirmation (`incident:banok:<user>:<cardId>`); every decision is written to the card and to `moderation` via `logModAction`.

**Officer alerts.** `logs/alerts.ts::sendAlert` posts to `settings.alerts.channelId` and pings `alerts.roleId`. Sources: late cancellations (`raids/handlers.ts::alertIfLate`) and attendance (`raids/attendance.ts`, pure `computeAttendance` + `reportAttendance`, stored in `raid_attendance`). The scheduler also sends the «Сбор!» call (`reminded_gather`) and runs the attendance check (`attendance_done`); raids from templates ping `template.pingRoleIds` on open.

**Temporary channels.** `/tempchannel` creates a text or voice channel and stores its expiry in `temp_channels`; `lib/tempChannels.ts` deletes expired ones on ready and every minute (a voice channel with people waits until it is empty).

**Auto-clean.** `lib/autoClean.ts` runs on ready and every 10 min over `settings.autoClean`: fetches only messages older than the cutoff (snowflake `before`), skips pinned (and the bot's own if `keepBot`), bulk-deletes those younger than 14 days in chunks of 100 and deletes older ones one by one (max 25 per pass). Deleted ids go through `markDeletedByBot` so the message log skips them (bulk included) and gets one summary instead.

**Timed roles.** `/rolepanel … hours:N` encodes the duration in the button customId (`role:<roleId>:<hours>`); grants are stored in `temp_roles` and `lib/tempRoles.ts` removes expired ones on ready and every minute.

**Raid templates.** `settings.raidTemplates` (admin page «Рейды», path `/templates`; «Настройки рег» at `/raids` holds the rest of `settings.raids`). A template has `pingRoleIds`, access lists `mainRoleIds` (empty = everyone) / `reserveRoleIds` (reserve-only, requires main), and `slots` `{raidDay, raidTime, openDay, openTime}`: the reg opens at the latest openDay/openTime before the raid, at most 7 days (`slots.ts::daysAfterOpen`, mirrored in `admin-ui/src/lib/week.ts`). Legacy `raids.schedules` (open days + one offset) are migrated in `getSettings()` *before* `merge()` (which drops unknown keys). `scheduler.ts::raidFromTemplate` snapshots the access lists into `raids.main_role_ids`/`reserve_role_ids`; `lineup.ts::signupAccess` checks member roles on class/spec select, `raid_signups.reserve` keeps reserve-only signups on the bench, and `lineup()` is the single main/bench/tentative split (render, archive, gather call, attendance). `POST /api/templates/:id/create` validates date/time and bot permissions, then calls `publishRaid` with the logged-in admin as leader.

**Activity kinds and groups.** `raids/kinds.ts`: `raid | dungeon | pvp` with words for texts (`title`/`word`/`to`/`from` — no gendered verbs, use «отменили»/«перенесли») and default size/limits; `RoleLimits` {tank, healer, dps} (null = no limit) live on templates and snapshot into `raids.kind`/`raids.limits`. `lineup(signups, size, limits)` fills main in signup order while total and per-role seats remain; `fullGroups` marks full roles in the spec menu; `setRaidLimits` changes an open reg. Player groups: `/group create|cancel|move|limits` (`commands/raids/group.ts`, rules in `raids/groups.ts`) driven by `settings.groups.dungeon|pvp` {channelId, size, limits, creatorRoleIds}; creator manages own group, `ManageEvents` manages any reg. `raids.player` skips Discord events, late-cancel alerts, attendance and the temp raid role. Cancel/move/new start are shared `cancelRaid`/`moveRaid`/`newStart` in `service.ts`. Admin: page «Сборы» (`/templates`), «Настройки рег» has tabs «Реги» / «Группы от игроков», attendance filters by `kind`.

**Admin panel.** Two parts. **Server (`src/admin/`)**: Hono app in the bot process, bound to `127.0.0.1:ADMIN_PORT`, started from `ready` only if `CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `SESSION_SECRET` are set. `server.ts` handles Discord OAuth2 (`/login`, `/auth/callback` → failure redirects to `/?login-failed`, `/logout`), mounts the JSON API at `/api` (`api.ts`) and serves `admin-ui/dist` (`ADMIN_UI_DIST` overrides; hashed `/assets/*` immutable, every other GET → `index.html` for client routing; without a build — a «выполни `pnpm build`» page). `api.ts` checks the signed session cookie and `ManageGuild` on the `GUILD_ID` guild on every request (401/403 JSON) and the `X-CSRF-Token` header (= `session.csrf`, served by `GET /api/me`) on non-GET; settings are saved per section via `PUT /api/settings/:section` (guild checks from `forms.ts` + `validateSettings`, then `saveSettings`, a `server` log entry and side effects like `refreshBoard`/`refreshStickies`); errors are `400 {errors: string[]}` in Russian, shown as-is. `apiTypes.ts` is import-free and shared with the UI (alias `@api`); `settingsJson(s: BotSettings): Api.Settings` makes tsc check it against the real types. **UI (`admin-ui/`)**: React 19 + shadcn/ui on **Base UI** (`render` prop, not `asChild`; add components with `npx shadcn@latest add <name>` inside `admin-ui`), Tailwind v4, Lucide icons, TanStack Query, react-router (declarative `BrowserRouter`; pages lazy-loaded in `App.tsx`, polls have nested routes in `pages/polls/index.tsx`). Own theme provider (`lib/theme.tsx`, `localStorage` key `tlh-theme`, dark default, pre-paint script in `index.html`). Settings pages use `lib/settings-form.ts::useSectionForm` (draft, dirty, save bar, «Уйти без сохранения?» via `lib/unsaved.ts`) and `components/entity-picker.tsx` (Combobox with search for channels/roles). Code style in `admin-ui` is enforced by `vp check` (single quotes, width 140); UI text is Russian like the bot.

**Sveta (AI persona, `src/sveta/`).** A second discord.js `Client` in the same process (`startSveta()` in `src/index.ts`, token `SVETA_TOKEN`; no token → not started) with minimal permissions (`SVETA_PERMISSIONS`: view, send, read history, reactions). `onMessage`: `triggers.ts::triggerOf` (mention of her or her managed bot role / reply to her / name via `callsByName` / rare random) only in `settings.sveta.channelIds` → `limits.ts::Limiter` (per-user cooldown, per-hour, per-day counted in `sveta_usage` by Kyiv day, 1-hour pause after Gemini 429; a "break" line at most once an hour) → last 15 messages via `context.ts::buildContents` → `gemini.ts::generate` (REST `generateContent` with `fetch`, key in `x-goog-api-key`, `BLOCK_ONLY_HIGH` safety, `thinkingLevel: LOW` except gemini-1/2) → reply without mentions. System prompt = admin-editable persona + fixed chat rules + `tools.ts::guildSummary` (3 upcoming regs) (`persona.ts`). Read-only tools `upcoming_raids` / `raid_roster` / `raid_schedule` (`tools.ts::runTool`, scoped to the message guild): up to `MAX_TOOL_ROUNDS` = 2, last round `toolMode: NONE`; the model content with a function call is appended verbatim (keeps Gemini 3 `thoughtSignature`), one `functionResponse` per call with the same `id`. Requests per day are counted in `sveta_usage.requests`. Memory (`memory.ts`, table `sveta_people`: attitude −100…100, nickname, ≤ 10 notes): dossiers of conversation participants go into the system prompt; write tools `remember` / `change_attitude` / `set_nickname` always target the message author (enforced in code), ±20 per change, ≤ 3 writes per reply, no follow-up request when the reply already has text and only memory calls; «что ты обо мне помнишь» / «забудь меня» (`memoryCommand`) are answered by code without Gemini; admin `GET/PUT/DELETE /api/sveta/people`. Officer-written lore `settings.sveta.lore` ({names, story}[], read-only for the model): `lore.ts::matchLore` adds entries whose name/alias appears in the last messages or participants' names (word with ≤ 3-letter ending, ≤ 5 entries). `news.ts::announceRaid` posts canned lines (no Gemini) to `sveta.newsChannelId` on reg open (`publishRaid`), gather call (scheduler), `moveRaid`, `cancelRaid`. Admin page «Света» (`settings.sveta`, `GET /api/sveta/status`). Decided: no discord-mcp; later phases add own tools (raids, memory, soft moderation) checked in code (TASK-43).

**Other features.** Welcome message and the public poll message use Components V2 (`MessageFlags.IsComponentsV2`; such messages can't contain embeds or `content`). The profanity filter (`src/lib/profanity.ts`) normalizes text (lookalike letters, separators, repeated letters, spaced letters) then matches roots with a whitelist; when changing it, add cases to `profanity.test.ts` (both caught and must-not-trigger words).

## Deployment

`docs/deploy.md` is the VPS guide (Ubuntu, Node 26, systemd unit in `deploy/thelasthope-bot.service`, Caddy reverse proxy with automatic HTTPS in `deploy/Caddyfile`, `ADMIN_URL=https://…` switches the admin to secure cookies). `lib/backup.ts` copies the DB online with `node:sqlite` `backup()` into `data/backups/` once a day (checked hourly, also on start) and keeps 14 copies; `pnpm backup` does it manually. Only one bot instance may run per token — two instances handle every event twice.

## Conventions

- User-facing Russian text addresses the user with «ты» and avoids gendered forms (no «записался/уверен»; rephrase neutrally).
- Docs: `README.md` is intentionally friendly and non-technical (owner asked for no tech stack there); `docs/guide.md` is the user/officer guide with examples; `docs/checklist.md` lists what is ready and how to verify each feature in Discord (add a section for every new feature); `docs/development.md` holds setup and architecture. Update them when behavior changes.

<!-- BACKLOG.MD GUIDELINES START -->
<!-- backlog.md-instructions-version: 1.53.0 -->
<CRITICAL_INSTRUCTION>

## Backlog.md Workflow

This project uses Backlog.md for task and project management.

**At the beginning of each conversation in this project, run `backlog instructions overview` before answering or taking action. Re-read it only if you have not read it yet in the current conversation.**

Use the overview to decide whether to search, read, create, or update Backlog tasks.

Before task lifecycle actions, read the matching detailed guide:
- `backlog instructions task-creation` before creating or splitting tasks
- `backlog instructions task-execution` before planning, changing status or assignee, adding a plan or implementation notes, or implementing task work
- `backlog instructions task-finalization` before checking acceptance criteria, writing final summaries, or moving tasks to terminal statuses

Use `backlog <command> --help` before running unfamiliar commands. Help shows options, fields, and examples.

Do not edit Backlog task, draft, document, decision, or milestone markdown files directly. Use the `backlog` CLI so metadata, relationships, and history stay consistent.

</CRITICAL_INSTRUCTION>
<!-- BACKLOG.MD GUIDELINES END -->
