---
id: TASK-56
title: 'Админка: доступ по списку ADMIN_USER_IDS'
status: In Progress
assignee: []
created_date: '2026-10-26 21:29'
labels: []
dependencies: []
priority: medium
ordinal: 34000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
В админку пускают только тех, у кого на сервере гильдии есть право «Управлять сервером». Владелец-разработчик (Эйн) на главном сервере его не имеет — сервер и бот принадлежат ГМу (Музону), а давать роли «админ» это право целиком слишком широко. Музон согласен, чтобы разработчик заходил в админку главного.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Участник сервера гильдии, чей Discord ID есть в ADMIN_USER_IDS (в .env, через запятую), входит в админку без права «Управлять сервером»; остальных по-прежнему пускает только это право
- [ ] #2 Без ADMIN_USER_IDS всё как раньше; не участника сервера список не пускает
- [ ] #3 На главном в ADMIN_USER_IDS есть ID владельца; автотесты, .env.example и документация обновлены
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
config.ts — геттер adminUserIds (ADMIN_USER_IDS через запятую или пробел); api.ts — пускать при ManageGuild или ID из списка; тест в api.test.ts; .env.example, guide/development/deploy, CLAUDE.md; на главном — строка в .env и перезапуск.
<!-- SECTION:PLAN:END -->
