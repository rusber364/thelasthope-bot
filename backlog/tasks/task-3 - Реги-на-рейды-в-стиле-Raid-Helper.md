---
id: TASK-3
title: Реги на рейды в стиле Raid-Helper
status: Done
assignee: []
created_date: '2026-10-15 22:21'
updated_date: '2026-10-15 22:21'
labels:
  - рейды
dependencies: []
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Гильдии нужна запись на рейды WoW Forever без платного Raid-Helper: автоматическое открытие рег, выбор класса и спека, напоминания.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Реги открываются по расписанию (чт/пт/пн 00:00 по Киеву) в двух каналах и вручную через /raid create
- [x] #2 Состав по колонкам ролей, номер записи, иконки классов и спеков WoW
- [x] #3 Напоминания в ЛС за сутки и за час, закрытие записи при старте
- [x] #4 Лимиты Discord соблюдены для состава до 80 человек
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Сделано. Проверено тестами расписания (Temporal, переход на зимнее время), сборкой сообщений на 29/45/80 записей в пределах лимитов Discord и просмотром владельцем.
<!-- SECTION:FINAL_SUMMARY:END -->
