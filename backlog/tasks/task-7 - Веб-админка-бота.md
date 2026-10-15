---
id: TASK-7
title: Веб-админка бота
status: Done
assignee: []
created_date: '2026-10-15 22:21'
updated_date: '2026-10-15 22:21'
labels:
  - админка
dependencies: []
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Настройки (каналы, роли, тексты, расписание) нужно менять без правки .env и перезапуска бота.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Вход через Discord только для тех, у кого есть право «Управлять сервером»
- [x] #2 Страницы: каналы и роли, логи, приветствие, расписание рег
- [x] #3 Сохранения проверяются и применяются без перезапуска
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Сделано на Hono в процессе бота (localhost:3000). Проверено тестами админки через HTTP (вход, отказ не-админу, CSRF, сохранение) и входом владельца.
<!-- SECTION:FINAL_SUMMARY:END -->
