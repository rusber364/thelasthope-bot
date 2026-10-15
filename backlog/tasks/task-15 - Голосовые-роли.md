---
id: TASK-15
title: Голосовые роли
status: Done
assignee:
  - '@claude'
created_date: '2026-10-15 22:21'
updated_date: '2026-10-15 22:40'
labels:
  - этап-1
  - простое
  - carl-bot
  - роли
dependencies: []
references:
  - 'https://carl.gg/get-premium'
priority: high
ordinal: 600
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Carl-bot Premium выдаёт роль при входе в голосовой канал и снимает при выходе — удобно для доступа к текстовому каналу рейда во время рейда.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Вход в связанный голосовой канал выдаёт роль, выход снимает
- [x] #2 Связки «голосовой канал → роль» настраиваются в админке
- [x] #3 После перезапуска роли приводятся в соответствие с текущими голосовыми
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Настройка voiceRoles: список связок {channelId, roleId} с проверкой
2. src/lib/voiceRoles.ts: чистые voiceRoleDiff (что выдать/снять при смене канала) и voiceRoleSync (сверка всех участников), обработчик VoiceStateUpdate, syncVoiceRoles(guild)
3. Сверка при запуске (ready) и после сохранения в админке
4. Админка: блок «Голосовые роли» на странице «Каналы и роли» (строки связок + пустая строка для новой, удаление галочкой)
5. Тесты: diff, sync, событие, админка; документация
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Реализовано: настройка voiceRoles (список связок с проверкой), src/lib/voiceRoles.ts (чистые voiceRoleDiff и voiceRoleSync, обработчик VoiceStateUpdate, syncVoiceRoles), сверка при запуске (ready) и сразу после сохранения в админке, блок «Голосовые роли» на странице «Каналы и роли» (строки связок, пустая строка для новой, удаление галочкой, проверка что канал голосовой). Голосовая роль считается «только голосовой»: при сверке снимается у всех, кого нет в канале. Проверено тестами: voiceRoles.test.ts (вход/выход/переход с общей ролью, сверка, событие, syncVoiceRoles на подставном сервере), тест админки (сохранение, текстовый канал — ошибка, удаление). В живом Discord не проверялось.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Голосовые роли: вход в связанный голосовой канал выдаёт роль, выход снимает; связки задаются в админке; при запуске и после сохранения роли сверяются с текущими голосовыми. Проверено: 116 тестов, в т.ч. voiceRoles.test.ts и тест админки.
<!-- SECTION:FINAL_SUMMARY:END -->
