---
id: TASK-4
title: Опросы из текстового файла
status: Done
assignee: []
created_date: '2026-10-15 22:21'
updated_date: '2026-10-15 22:21'
labels:
  - опросы
dependencies: []
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Офицерам нужны многостраничные опросы как у Starlight (формы с радиокнопками, условия показа блоков), без платных ботов.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Опрос описывается текстовым файлом и публикуется /poll create
- [x] #2 Блоки показываются по условиям «Если:»
- [x] #3 Итоги с процентами и CSV через /poll results
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Сделано. Проверено тестами разбора файла опроса (пример на 14 вопросов, условия, ошибки с номерами строк) и сборкой форм в пределах лимитов Discord.
<!-- SECTION:FINAL_SUMMARY:END -->
