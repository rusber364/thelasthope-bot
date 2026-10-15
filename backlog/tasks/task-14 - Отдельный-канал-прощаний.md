---
id: TASK-14
title: Отдельный канал прощаний
status: Done
assignee:
  - '@claude'
created_date: '2026-10-15 22:21'
updated_date: '2026-10-15 22:37'
labels:
  - этап-1
  - простое
  - carl-bot
  - приветствие
dependencies: []
references:
  - 'https://carl.gg/get-premium'
priority: high
ordinal: 500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Carl-bot Premium публикует прощания в отдельный канал. Гильдии полезно видеть уход людей публично, отдельно от лога.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 При выходе участника в выбранный канал публикуется прощание
- [x] #2 Текст прощания с подстановками настраивается в админке
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Настройки farewell {channelId, text} с подстановками {user} {name} {server} {members}, проверка текста
2. src/welcome/farewell.ts: чистая fillFarewell + обработчик выхода участника (боты пропускаются, упоминания не пингуют)
3. Админка: блок «Прощание» на странице «Приветствие» + кнопка пробного прощания
4. Тесты: подстановки, отправка при выходе, сохранение в админке; документация
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Реализовано: настройки farewell {channelId, text} (текст проверяется), src/welcome/farewell.ts (fillFarewell, sendFarewell, обработчик выхода участника; боты пропускаются, упоминания не пингуют), блок «Прощание» на странице «Приветствие» админки с кнопкой пробного прощания. Проверено тестами: farewell.test.ts (подстановки, отправка через событие GuildMemberRemove, пропуск ботов, без канала — ничего), тест админки (сохранение канала и текста, ошибка пустого текста). В живом Discord не проверялось.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Канал прощаний: при выходе участника бот публикует прощание в выбранный канал; канал и текст с подстановками {user} {name} {server} {members} настраиваются в админке, есть пробная отправка. Проверено: 111 тестов, в т.ч. farewell.test.ts и тест админки.
<!-- SECTION:FINAL_SUMMARY:END -->
