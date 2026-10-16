---
id: TASK-26
title: Перенос бота на VPS (24/7)
status: In Progress
assignee:
  - '@claude'
created_date: '2026-10-15 22:21'
updated_date: '2026-10-16 12:44'
labels:
  - этап-2
  - среднее
  - своё
  - инфраструктура
dependencies: []
priority: medium
ordinal: 1700
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Сейчас бот работает только пока включён компьютер владельца; админка доступна только локально. Для гильдии нужен круглосуточный бот и админка для офицеров.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Бот запущен на VPS как служба с автоперезапуском
- [ ] #2 Админка доступна по домену через HTTPS, вход через Discord
- [x] #3 Резервная копия базы data/bot.db по расписанию
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Резервные копии: lib/backup.ts (копия базы на ходу через node:sqlite backup, раз в сутки — проверка раз в час и при запуске, хранить 14), pnpm backup.
2. deploy/thelasthope-bot.service (systemd, автоперезапуск, отдельный пользователь) и deploy/Caddyfile (HTTPS для админки через Caddy).
3. docs/deploy.md: сервер, Node 26, установка, перенос базы, служба, домен и HTTPS, ufw, копии и восстановление, обновление.
4. Сам перенос на VPS делает владелец (нужны сервер и домен) — пункты в чек-листе.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Подготовлено в репозитории: служба systemd, Caddyfile, ежедневные копии базы в самом боте (работает на любой ОС, без cron), docs/deploy.md. Админка уже поддерживает HTTPS через ADMIN_URL (secure-cookie). Проверено: backup.test.ts (копия читается и содержит данные; хранятся последние N), pnpm backup на реальной базе, автокопия при старте живого бота (data/backups/bot-2026-10-16_15-41.db). Не проверено: запуск на VPS и админка по домену — нужен сервер владельца. Всего 172/172, typecheck.
<!-- SECTION:NOTES:END -->
