---
id: TASK-18
title: События Discord для рег
status: Done
assignee:
  - '@claude'
created_date: '2026-10-15 22:21'
updated_date: '2026-10-16 12:02'
labels:
  - этап-2
  - среднее
  - raid-helper
  - рейды
dependencies: []
references:
  - 'https://raid-helper.dev/premium/'
priority: medium
ordinal: 900
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Raid-Helper Premium создаёт события Discord: рейды видны во вкладке «События» сервера с напоминаниями Discord.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Для каждой реги создаётся событие сервера с датой и ссылкой на регу
- [x] #2 Отмена реги отменяет событие, изменение времени обновляет его
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. raids.event_id (addColumn), store: getRaidEventId/setRaidEventId, setRaidStart (перенос со сбросом напоминаний).
2. raids/events.ts: syncRaidEvent — открытая рега → создать/обновить внешнее событие (название, начало, конец +3 ч, место = ссылка на регу, описание, обложка = картинка реги или общий фон); отменена → событие отменено; началась → событие активно. Нет права «Создавать события» — пропуск с одним предупреждением.
3. Вызовы: publishRaid, /raid cancel, закрытие в планировщике, новая /raid move (перенос даты/времени с ЛС записавшимся).
4. Настройка raids.discordEvents (галочка в админке, по умолчанию вкл.); право CreateEvents в ссылке-приглашении.
5. Тесты, руководство, чек-лист.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Событие EXTERNAL (Discord сам завершает его в scheduled_end_time = начало + 3 ч), место — ссылка на регу, обложка — своя картинка реги или общий фон. Синхронизация не на каждую запись, а при публикации, отмене, переносе и закрытии. Для AC «изменение времени» добавлена /raid move (перенос даты/времени: регa, событие, напоминания заново, ЛС записавшимся). Права: CreateEvents добавлено в ссылку-приглашение; без права — одно предупреждение и пропуск. Тесты src/raids/events.test.ts (4); всего 145/145, typecheck.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Для каждой реги создаётся событие Discord (название, время, описание и ссылка на регу, обложка), /raid cancel отменяет его, новая /raid move переносит регу и событие, начавшийся рейд отмечает событие идущим; галочка в админке выключает функцию. Проверено events.test.ts (создание, перенос, отмена, начало, пересоздание удалённого, нет права, выключено) и полным прогоном 145/145; вживую — пункты в чек-листе (нужно право «Создавать события» и pnpm deploy для /raid move).
<!-- SECTION:FINAL_SUMMARY:END -->
