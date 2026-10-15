---
id: TASK-13
title: Архив прошедших рег
status: Done
assignee:
  - '@claude'
created_date: '2026-10-15 22:21'
updated_date: '2026-10-15 22:36'
labels:
  - этап-1
  - простое
  - raid-helper
  - рейды
dependencies: []
references:
  - 'https://raid-helper.dev/premium/'
priority: high
ordinal: 400
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Каналы рег засоряются старыми регами. Raid-Helper Premium архивирует события после окончания.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Через N часов после начала рега переносится в канал-архив или удаляется с кратким итогом
- [x] #2 Режим и канал архива настраиваются в админке
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Настройки raids.archive {mode: off|move|delete, channelId, hours} с проверкой (для move нужен канал)
2. Колонка raids.archived, запрос рег к архивации, сводка посещаемости
3. src/raids/archive.ts: чистая функция итога (состав по ролям, посещаемость, статус) + архивация в тике планировщика: move — итог и финальный состав в канал-архив, удалить регу; delete — удалить регу, итог в канал реги
4. Админка: блок «Архив прошедших рег» на странице «Расписание рег»
5. Тесты: итог, архивация с подставным Discord, админка; документация
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Реализовано: настройки raids.archive {mode off|move|delete, channelId, hours 1–72, по умолчанию off/6 ч} с проверкой (move требует канал), колонка raids.archived, запросы raidsDueForArchive/markArchived/attendanceCounts, модуль src/raids/archive.ts (чистая raidSummary + archiveRaids в тике планировщика), блок «Архив прошедших рег» в админке. Проверено тестами: archive.test.ts (итог по ролям/запасу/посещаемости, перенос: итог+состав в архиве и удаление реги, свежая рега не тронута, повторный тик без дублей; удаление: итог в канале реги, отменённая рега; выключенный режим), тест админки (сохранение и ошибка без канала-архива). В живом Discord не проверялось.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Архив прошедших рег: через N часов после начала рега переносится в канал-архив (итог + финальный состав) или удаляется с кратким итогом в канале реги; режим, канал и N выбираются в админке. Состояние хранится в базе, повторов нет. Проверено: 107 тестов, в т.ч. archive.test.ts и тест админки.
<!-- SECTION:FINAL_SUMMARY:END -->
