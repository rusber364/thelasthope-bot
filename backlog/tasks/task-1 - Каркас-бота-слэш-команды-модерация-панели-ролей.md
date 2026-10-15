---
id: TASK-1
title: 'Каркас бота: слэш-команды, модерация, панели ролей'
status: Done
assignee: []
created_date: '2026-10-15 22:19'
updated_date: '2026-10-15 22:19'
labels:
  - основа
  - модерация
dependencies: []
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Гильдии нужен свой Discord-бот вместо платных ботов. Основа: команды, модерация и выдача ролей кнопками, на которых строятся остальные функции.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Все команды регистрируются в Discord через pnpm deploy (12 команд на тестовом сервере)
- [x] #2 /ping отвечает на тестовом сервере
- [x] #3 Проверка типов и автотесты проходят
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Сделано в первой версии бота. Проверено: /ping работает на тестовом сервере (подтвердил владелец), команды собираются без ошибок (pnpm deploy), типы и тесты проходят.
<!-- SECTION:FINAL_SUMMARY:END -->
