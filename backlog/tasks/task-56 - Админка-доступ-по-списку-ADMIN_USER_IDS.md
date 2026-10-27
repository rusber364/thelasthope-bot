---
id: TASK-56
title: 'Админка: доступ по списку ADMIN_USER_IDS'
status: Done
assignee: []
created_date: '2026-10-26 21:29'
updated_date: '2026-10-27 00:12'
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
- [x] #1 Участник сервера гильдии, чей Discord ID есть в ADMIN_USER_IDS (в .env, через запятую), входит в админку без права «Управлять сервером»; остальных по-прежнему пускает только это право
- [x] #2 Без ADMIN_USER_IDS всё как раньше; не участника сервера список не пускает
- [x] #3 На главном в ADMIN_USER_IDS есть ID владельца; автотесты, .env.example и документация обновлены
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
config.ts — геттер adminUserIds (ADMIN_USER_IDS через запятую или пробел); api.ts — пускать при ManageGuild или ID из списка; тест в api.test.ts; .env.example, guide/development/deploy, CLAUDE.md; на главном — строка в .env и перезапуск.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Сделано по плану. Проверено: pnpm test 273/273 (api.test: ID из ADMIN_USER_IDS без права — 200, не из списка — 403, без переменной — снова 403), typecheck. Не участника не пускает: условие требует member (fetch не нашёл — null), отдельным тестом не покрыто. Выкачено на оба бота (0c82a9c), на главном в .env ADMIN_USER_IDS=321291457216643072 (Эйн), перезапуск без ошибок. Вход владельца в админку главного вживую не проверен.

27.10: владелец вошёл в админку главного (Эйн из ADMIN_USER_IDS) и сохранил страницу «Света».
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Админка пускает и участников сервера из ADMIN_USER_IDS в .env (через запятую), без права «Управлять сервером». На главном вписан владелец; проверено автотестами (из списка — 200, не из списка и без списка — 403) и вживую: владелец вошёл в админку главного.
<!-- SECTION:FINAL_SUMMARY:END -->
