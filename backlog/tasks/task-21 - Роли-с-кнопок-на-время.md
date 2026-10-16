---
id: TASK-21
title: Роли с кнопок на время
status: Done
assignee:
  - '@claude'
created_date: '2026-10-15 22:21'
updated_date: '2026-10-16 12:09'
labels:
  - этап-2
  - среднее
  - carl-bot
  - роли
dependencies: []
references:
  - 'https://carl.gg/get-premium'
priority: medium
ordinal: 1200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Carl-bot Premium выдаёт роли, которые сами истекают — для доступа на событие или раздачи.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 В панели ролей можно задать срок действия роли
- [x] #2 Роль снимается по истечении срока, в том числе после перезапуска бота
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. /rolepanel: необязательный параметр hours (1–720) — срок роли для всех кнопок панели; срок кладётся в customId кнопки (role:<id>:<часы>), старые панели работают как раньше.
2. Таблица temp_roles (сервер, участник, роль, когда снять); нажатие с выдачей — запись, повторное нажатие — роль и запись убираются.
3. lib/tempRoles.ts: снятие истёкших ролей при запуске и раз в минуту (по базе — переживает перезапуск).
4. Тесты, руководство, чек-лист.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Срок — на всю панель (параметр hours), лежит в customId кнопки; старые кнопки role:<id> работают без срока. Повторная выдача продлевает срок; снятие кнопкой удаляет запись. Ушедшие участники и удалённые роли просто забываются. Тесты src/lib/tempRoles.test.ts (3); всего 152/152, typecheck.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
/rolepanel получил параметр hours: роли с такой панели выдаются на время и снимаются сами; срок хранится в базе (temp_roles) и проверяется при запуске и раз в минуту, так что роль снимется и после перезапуска. Проверено tempRoles.test.ts (выдача со сроком, повторное нажатие, снятие по сроку только из базы, панель без срока) и полным прогоном 152/152; нужен pnpm deploy.
<!-- SECTION:FINAL_SUMMARY:END -->
