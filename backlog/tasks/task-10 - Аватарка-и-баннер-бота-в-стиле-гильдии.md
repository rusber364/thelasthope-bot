---
id: TASK-10
title: Аватарка и баннер бота в стиле гильдии
status: Done
assignee:
  - '@claude'
created_date: '2026-10-15 22:21'
updated_date: '2026-10-15 22:28'
labels:
  - этап-1
  - простое
  - carl-bot
  - raid-helper
dependencies: []
references:
  - 'https://carl.gg/get-premium'
  - 'https://raid-helper.dev/premium/'
priority: high
ordinal: 100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
У платных ботов своя аватарка — премиум-функция. Наш бот свой, поэтому достаточно поставить логотип гильдии (logo.jpg) как аватар и баннер.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Аватар бота — логотип гильдии
- [x] #2 Баннер профиля бота установлен
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. src/lib/branding.ts: выбрать файлы (assets/bot-avatar.*, assets/bot-banner.* или logo.jpg) и обновить профиль бота через REST PATCH /users/@me
2. Скрипт pnpm brand для разовой установки
3. Админка: блок «Оформление бота» на главной — текущие аватар и баннер, кнопки «Обновить аватар» и «Обновить баннер»
4. Тест маршрутов админки с подставным REST
5. Применить к боту и проверить по GET /users/@me, что avatar и banner заданы
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Реализовано: src/lib/branding.ts (PATCH /users/@me с data URI), скрипт pnpm brand, блок «Оформление бота» на главной админки с кнопками и записью в лог-сервер. Тест админки: кнопки отправляют картинку, ошибка частой смены показывается понятно. Применено к боту: pnpm brand → avatar и banner c45b8320…; GET /users/@me и CDN (200, image/png) подтверждают, на картинке логотип гильдии. Баннер пока из logo.jpg — для широкого баннера положить assets/bot-banner.png 680×240 и нажать «Обновить баннер».
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Аватар и баннер бота теперь логотип гильдии. Добавлены модуль оформления, скрипт pnpm brand и кнопки «Обновить аватар/баннер» на главной админки (с записью в лог-сервер). Проверено: 93 теста проходят (в т.ч. маршруты оформления), pnpm brand применил картинки, GET /users/@me и CDN Discord отдают логотип.
<!-- SECTION:FINAL_SUMMARY:END -->
