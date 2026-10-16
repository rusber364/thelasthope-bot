---
id: TASK-25
title: Статистика посещаемости рейдов
status: Done
assignee:
  - '@claude'
created_date: '2026-10-15 22:21'
updated_date: '2026-10-16 12:39'
labels:
  - этап-2
  - среднее
  - своё
  - рейды
  - админка
dependencies: []
priority: medium
ordinal: 1600
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Таблица raid_attendance уже копит данные. Офицерам нужна сводка: кто сколько рейдов посетил и пропустил.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Команда /history @игрок показывает посещаемость и пропуски
- [x] #2 В админке страница статистики за период
- [x] #3 Учитываются отметки «под вопросом»
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. raids/attendanceStats.ts: строки посещаемости за период (raid_attendance + raids + отметка «под вопросом» из raid_signups), чистая сводка по игрокам: пришёл, пропустил, «?» и пришёл, «?» и не пришёл, без записи, процент = пришёл / (пришёл + пропустил).
2. /history player [days]: сводка игрока за период (по умолчанию 30 дней) и последние рейды с отметками; для офицеров (право как у /raid).
3. Админка: страница «Посещаемость» — таблица по всем игрокам за период (даты «с» и «по», по умолчанию 30 дней), сколько рейдов проверено.
4. memberNames переносится в lib/members.ts (нужен и опросам, и посещаемости).
5. Тесты, руководство, чек-лист, pnpm deploy — пользователю.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Отметка «под вопросом» берётся из raid_signups.tentative (в raid_attendance для пришедших её нет). Формулировки без рода («на рейде», «пропуск»). /history — для офицеров (право «Управлять событиями», как /raid), ответ виден только вызвавшему. Тесты: src/raids/attendanceStats.test.ts (3, в т.ч. /history), страница админки в server.test.ts; всего 170/170, typecheck.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Статистика посещаемости: /history @игрок [days] показывает процент, счётчики и последние рейды с отметками; страница админки «Посещаемость» — таблица по всем игрокам за выбранный период (сверху чаще пропускающие). Отметки «под вопросом» учитываются отдельно (на рейде / не было) и не считаются пропуском. Проверено attendanceStats.test.ts и тестом админки, всего 170/170; нужен pnpm deploy для /history.
<!-- SECTION:FINAL_SUMMARY:END -->
