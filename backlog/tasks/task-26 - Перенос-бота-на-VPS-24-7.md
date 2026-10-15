---
id: TASK-26
title: Перенос бота на VPS (24/7)
status: To Do
assignee: []
created_date: '2026-10-15 22:21'
labels:
  - этап-2
  - среднее
  - своё
  - инфраструктура
dependencies: []
priority: medium
ordinal: 1700
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Сейчас бот работает только пока включён компьютер владельца; админка доступна только локально. Для гильдии нужен круглосуточный бот и админка для офицеров.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Бот запущен на VPS как служба с автоперезапуском
- [ ] #2 Админка доступна по домену через HTTPS, вход через Discord
- [ ] #3 Резервная копия базы data/bot.db по расписанию
<!-- AC:END -->
