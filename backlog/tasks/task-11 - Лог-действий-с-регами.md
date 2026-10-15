---
id: TASK-11
title: Лог действий с регами
status: Done
assignee:
  - '@claude'
created_date: '2026-10-15 22:21'
updated_date: '2026-10-15 22:31'
labels:
  - этап-1
  - простое
  - raid-helper
  - рейды
  - логи
dependencies: []
references:
  - 'https://raid-helper.dev/premium/'
priority: high
ordinal: 200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Raid-Helper Premium пишет каждое действие с регой в канал. Офицерам полезно видеть всю историю записей, а не только поздние отписки.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Запись, смена спека, «под вопросом» и отписка пишутся в выбранный канал
- [x] #2 Канал и включение настраиваются в админке
- [x] #3 Записи ботом не дублируются
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Шестая категория лога raids («лог-рейдов») в botSettings — страница «Логи» и тестовое сообщение подхватят её сами
2. src/raids/actionLog.ts: чистая функция raidActionEntry(до, после) → запись или null (повторный выбор того же спека — null)
3. Вызовы из кнопок реги: выбор спека, «под вопросом», отписка
4. Тесты actionLog и админки, документация
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Реализовано: категория логов raids («лог-рейдов») в botSettings (страница «Логи» и тестовое сообщение подхватили её автоматически), src/raids/actionLog.ts (чистая raidActionEntry + logRaidAction), вызовы из выбора спека, «под вопросом» и отписки. Проверено: юнит-тесты actionLog, интеграционный тест обработчика кнопок реги с подставным Discord (5 действий → 5 записей, повтор того же спека → 0, выключенный лог → 0), тест админки на сохранение канала. В живом Discord не проверялось.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Добавлен шестой лог «лог-рейдов»: запись, смена спека, «под вопросом» и отписка пишутся в выбранный в админке канал; повторный выбор того же спека не создаёт дубль. Проверено: 100 тестов, в т.ч. интеграционный тест обработчика кнопок реги и тест страницы «Логи».
<!-- SECTION:FINAL_SUMMARY:END -->
