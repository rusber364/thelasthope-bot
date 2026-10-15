---
id: TASK-24
title: Разбор инцидентов модерации с кнопками
status: To Do
assignee: []
created_date: '2026-10-15 22:21'
labels:
  - этап-2
  - среднее
  - carl-bot
  - модерация
dependencies: []
references:
  - 'https://carl.gg/get-premium'
priority: medium
ordinal: 1500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Carl-bot Premium (Drama Watcher) присылает инциденты в канал модераторов с кнопками действий — не нужно искать по логам.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Удаление мата и подозрительные события публикуются в канал модераторов
- [ ] #2 Кнопки «Мут», «Бан», «Пропустить» выполняют действие с проверкой прав нажавшего
- [ ] #3 Действия попадают в лог-модерация
<!-- AC:END -->
