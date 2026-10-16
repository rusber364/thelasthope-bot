# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Discord bot for the WoW Forever guild **The Last Hope** (Alliance). The owner communicates in Russian; all user-facing bot text and docs are Russian.

## Commands

```bash
pnpm install          # pnpm only (packageManager is pinned in package.json)
pnpm dev              # node --watch, restarts on src changes; reads .env only at startup
pnpm start
pnpm deploy           # register slash commands in Discord (this script shadows pnpm's built-in `deploy`)
pnpm test             # node --test "src/**/*.test.ts"
pnpm typecheck        # tsc, type-check only (noEmit)
```

Single test file / single test:

```bash
node --test src/lib/profanity.test.ts
node --test --test-name-pattern="ловит" src/lib/profanity.test.ts
```

Tasks are tracked with Backlog.md, installed as a dev dependency — run it as `pnpm backlog …` (plain `backlog` is not on PATH). In Git Bash set `MSYS_NO_PATHCONV=1` when an argument starts with `/` (e.g. `--ac '/raid …'`), otherwise MSYS rewrites it into a Windows path. Task text is in Russian.

There is no build step and no linter. `pnpm deploy` must be re-run whenever a command's `data` (name, options, permissions) changes. With `GUILD_ID` set it registers guild commands and clears global ones; it needs the bot already invited to that guild (otherwise `Missing Access`).

## Runtime constraints

- Node 26+ runs `.ts` directly via type stripping. Consequences enforced by `tsconfig.json`: relative imports use the `.ts` extension, `import type` for types (`verbatimModuleSyntax`), and only erasable syntax (`erasableSyntaxOnly`: no enums, namespaces, parameter properties).
- Uses Node built-ins instead of deps: `node:sqlite` (`DatabaseSync`) and the global `Temporal` (typed via `lib: esnext.temporal`). Runtime deps: discord.js 14, `hono` + `@hono/node-server` (admin panel).
- `src/config.ts` reads `.env` (token, guild, admin OAuth secrets). `config.token` is a lazy getter so tests can import modules without a `.env`.
- Settings are split: **`src/botSettings.ts`** holds everything editable from the admin panel (channels, roles, welcome texts, raid schedules, 5 log channels) as one JSON row in the `settings` table, merged as defaults ← `.env` IDs ← DB. Always read via `getSettings()` at call time (never cache at module load) so admin changes apply without restart. **`src/settings.ts`** holds non-editable constants (timezone `Europe/Kyiv`, profanity filter).
- `BOT_DB_PATH` overrides the DB path; tests set it to `:memory:` (and other env vars) *before* dynamically importing modules — see `src/botSettings.test.ts`, `src/admin/server.test.ts`.

## Architecture

**Interaction routing.** `src/events/interactionCreate.ts` dispatches:
- slash commands → `commandsByName` from `src/commands/index.ts`. Each command implements `Command` (`src/types.ts`) and receives `ChatInputCommandInteraction<'cached'>`; all commands are guild-only.
- buttons / selects / modals → by `customId` prefix. `customId` format is `<prefix>:<action>:<args…>`; `src/components.ts` maps prefixes (`role`, `welcome`, `raid`, `poll`) to `ComponentHandler`s. All state needed by a component lives in its `customId` + SQLite, so components keep working across restarts.
- Discord requires a response within 3 s: handlers reply/update first, then do slow work (e.g. redrawing a raid message).

**Persistence.** `src/db.ts` creates `data/bot.db` (gitignored) with `CREATE TABLE IF NOT EXISTS` plus `addColumn(...)` for migrating older DBs — add new columns there, not only in the CREATE statement. Row ↔ object mapping is in `src/raids/store.ts` and `src/polls/store.ts`.

**Raids (`src/raids/`).**
- `classes.ts`: classes/specs/roles. `ROLE_ORDER` (tank, melee, ranged, healer) drives the embed column layout — Discord places 3 inline fields per row, so healers land under tanks.
- `emojis.ts`: class/spec/UI icons are Discord *application emojis* named `wf_<id>` / `wf_ui_<key>`, auto-uploaded from wowhead (`wow.zamimg.com`) by `ensureAppEmojis` on ready. Use `specEmoji` / `classEmoji` / `uiEmoji` — raid UI must use these WoW icons, not Unicode emoji.
- `render.ts`: Raid-Helper-style **embed** (not Components V2, because columns need inline fields). Optional banner `assets/raid-banner.*` is a separate image-only embed; on every edit the file is re-uploaded with `attachments: []`. Signup number = position by `created_at`; bench/tentative are computed at render time, not stored.
- `service.ts`: `publishRaid`, `refreshRaidMessage` (coalesces concurrent redraws). Raid messages created by older versions as Components V2 cannot be converted to embeds, so they are reposted and the old message deleted.
- `wizard.ts` + `drafts.ts`: `/raid create` is a Raid-Helper-style DM wizard (title → description → date → time → image → preview/publish). State lives in `raid_drafts` (one per user, 2 h TTL), buttons use prefix `rwiz` and are routed from DMs (non-guild interactions) in `interactionCreate`; DM text arrives via `MessageCreate` (needs `DirectMessages` intent + `Partials.Channel`). Each user's answers are processed sequentially (`inQueue`), and a button only acts if it belongs to the draft's latest prompt. A custom image is stored in `raid_images` and re-attached on every redraw instead of the shared banner. `/raid quick` is the old one-command create.
- `board.ts`: optional live «Ближайшие рейды» message (`settings.raids.boardChannelId`, message id in `raid_boards`). `publishRaid` and every `refreshRaidMessage` call `requestBoardRefresh` (1.5 s debounce, serialized per guild); `refreshBoard` also runs on ready and after saving the admin raids page.
- `events.ts`: `syncRaidEvent` mirrors a raid into an EXTERNAL guild scheduled event (location = raid link, end = start + 3 h, Discord auto-completes it; id in `raids.event_id`). Called on publish, `/raid cancel`, `/raid move` (reschedule: `setRaidStart` also resets reminder flags) and when the scheduler closes a started raid — not on every signup. Needs the bot's `CreateEvents` permission; toggle `settings.raids.discordEvents`.
- `personalReminders.ts`: «Напомнить» button → ephemeral select (10/30/60/120 min), stored in `raid_personal_reminders`, sent by the scheduler tick; `setRaidStart` resets them.
- `scheduler.ts`: 30 s tick — opens scheduled raids (idempotent via unique `schedule_key = <scheduleId>:<date>`, with a catch-up window), sends DM reminders (flags `reminded_day`/`reminded_hour` are set *before* sending), closes started raids.

**Polls (`src/polls/`).** Polls are authored as a Russian text file (`examples/poll-example.txt`) parsed by `format.ts` into a `PollDefinition` stored as JSON: `#` title, `##` block = one modal page (≤ 5 components incl. intro text), `###` question (`*` = required), `( )` single / `[ ]` multiple / `Ответ: короткий|длинный`, `Если: Вопрос = Вариант` (`!=`) conditions that may only reference earlier blocks. `render.ts` picks the component (≤ 10 options → radio/checkbox group, else string select). Modals can't open from a modal submit, so an ephemeral Components V2 "progress card" with a «Продолжить» button sits between pages. Results: embed + CSV (UTF-8 BOM, `;` separator for Russian Excel). `service.ts` holds publish / close+redraw / member names / `pollStats`, shared by `/poll` and the admin «Опросы» pages (editor with check + preview, multipart image upload, results, CSV, copy). The original text is stored in `polls.source` so the admin can copy a poll.

**Logs (`src/logs/`).** `sendLog(guild, category, embed)` routes to the channel configured for `members | server | messages | voice | moderation`. Sources: member join/leave, message delete/update/bulk (needs `Partials.Message`; profanity-filter deletions are skipped via `markDeletedByBot`), voice channel changes, and `guildAuditLogEntryCreate` — the only event that tells *who* acted. `formatAuditEntry` (pure, tested) maps audit actions to `server` or `moderation` and drops entries whose executor is the bot itself. `lib/modlog.ts::logModAction` (used by moderation commands) writes to `moderation`. Requires intents `GuildVoiceStates`, `GuildModeration`, `GuildInvites` and the bot's `ViewAuditLog` permission. Invite attribution (`logs/invites.ts`) diffs invite `uses` counters, which Discord only exposes with `ManageGuild`.

**Moderation incidents.** `logs/incidents.ts` posts a card with «Мут 1 ч / Бан / Пропустить» buttons (prefix `incident`) to `settings.alerts.incidentChannelId` for profanity deletions (called from the filter), accounts younger than 3 days joining, and mass mentions. `actionProblem` checks the clicker's permission and role hierarchy; ban needs a second ephemeral confirmation (`incident:banok:<user>:<cardId>`); every decision is written to the card and to `moderation` via `logModAction`.

**Officer alerts.** `logs/alerts.ts::sendAlert` posts to `settings.alerts.channelId` and pings `alerts.roleId`. Sources: late cancellations (`raids/handlers.ts::alertIfLate`) and attendance (`raids/attendance.ts`, pure `computeAttendance` + `reportAttendance`, stored in `raid_attendance`). The scheduler also sends the «Сбор!» call (`reminded_gather`) and runs the attendance check (`attendance_done`); scheduled raids can ping `schedule.pingRoleId` on open.

**Temporary channels.** `/tempchannel` creates a text or voice channel and stores its expiry in `temp_channels`; `lib/tempChannels.ts` deletes expired ones on ready and every minute (a voice channel with people waits until it is empty).

**Auto-clean.** `lib/autoClean.ts` runs on ready and every 10 min over `settings.autoClean`: fetches only messages older than the cutoff (snowflake `before`), skips pinned (and the bot's own if `keepBot`), bulk-deletes those younger than 14 days in chunks of 100 and deletes older ones one by one (max 25 per pass). Deleted ids go through `markDeletedByBot` so the message log skips them (bulk included) and gets one summary instead.

**Timed roles.** `/rolepanel … hours:N` encodes the duration in the button customId (`role:<roleId>:<hours>`); grants are stored in `temp_roles` and `lib/tempRoles.ts` removes expired ones on ready and every minute.

**Raid templates.** `settings.raidTemplates` (admin page «Шаблоны рег»); `POST /templates/:id/create` validates date/time and bot permissions, then calls `publishRaid` with the logged-in admin as leader.

**Admin panel (`src/admin/`).** Hono app in the bot process, bound to `127.0.0.1:ADMIN_PORT`, started from `ready` only if `CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `SESSION_SECRET` are set. Discord OAuth2 (`identify`) → bot checks `ManageGuild` on the `GUILD_ID` guild on every request → signed session cookie carrying a CSRF token checked on every POST. Forms are parsed once in the auth middleware (`parseBody({ all: true })`, stored as `c.get('body')`) because Hono caches the first parse. Pages in `views.ts` are pure `hono/html` templates (no JSX — Node type stripping can't compile it). Saves go through `validateSettings` + guild checks, then `saveSettings` and a `server` log entry.

**Other features.** Welcome message and the public poll message use Components V2 (`MessageFlags.IsComponentsV2`; such messages can't contain embeds or `content`). The profanity filter (`src/lib/profanity.ts`) normalizes text (lookalike letters, separators, repeated letters, spaced letters) then matches roots with a whitelist; when changing it, add cases to `profanity.test.ts` (both caught and must-not-trigger words).

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
