---
id: TASK-5
title: Фильтр мата
status: Done
assignee: []
created_date: '2026-10-15 22:21'
updated_date: '2026-10-15 22:21'
labels:
  - модерация
dependencies: []
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
В чате гильдии не должно быть мата, включая замаскированный и транслит, без ложных срабатываний на обычные слова.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Удаляет мат, транслит и маскировку (х.у.й, xyй, повторы букв)
- [x] #2 Не трогает обычные слова (употреблять, застрахуй, хулиган и др.)
- [x] #3 За 3 нарушения за 10 минут — мут на 10 минут
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Сделано. Проверено тестами: 62 случая (мат и слова-исключения).
<!-- SECTION:FINAL_SUMMARY:END -->
