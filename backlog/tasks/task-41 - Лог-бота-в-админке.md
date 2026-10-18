---
id: TASK-41
title: Лог бота в админке
status: In Progress
assignee: []
created_date: '2026-10-18 16:14'
updated_date: '2026-10-18 16:21'
labels:
  - admin
  - logs
dependencies: []
priority: medium
ordinal: 19000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Владелец хочет видеть в админке, что бот писал в консоль, чтобы понимать, что случилось (например, почему рега открылась позже или не пришло уведомление), не заглядывая в терминал. Бот работает дома через pnpm dev, а потом будет на VPS — консоль там не видна.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Всё, что бот пишет в консоль (info, предупреждения, ошибки), сохраняется и переживает перезапуск; хранятся последние 5000 строк
- [ ] #2 Запуск бота, падение процесса и обрывы связи с Discord видны в логе
- [x] #3 Админка: страница «Лог бота» — время по Киеву, уровень, текст; фильтр «всё / предупреждения и ошибки / ошибки», поиск, автообновление, «Показать ещё», копирование
- [x] #4 Лог видят только те, у кого есть доступ к админке
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
src/lib/botLog.ts: перехват console.* (util.format, без ANSI), таблица bot_log (id, at, level, text), обрезка до 5000 строк; отметка запуска, uncaughtExceptionMonitor, события shard (disconnect/reconnecting/resume) в index.ts. GET /api/botlog?level&q&before&limit. admin-ui: pages/botlog.tsx, nav «Сервер» → «Лог бота». Тесты: botLog (формат, обрезка, фильтры), API.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Коммит: см. «Лог бота в админке (TASK-41)». Проверено: 191/191 тестов (botLog.test.ts — порядок, фильтры, поиск без учёта регистра, before, обрезка, перехват console; api.test — 403 без прав, фильтр/поиск), check:admin, build. Запущенный бот сразу начал писать в bot_log (отметки запуска, «Бот запущен», «Иконки WoW»). Страница проверена на подставном API с копией настоящего лога: фильтры, поиск, раскрытие стека, ширина 375 без вылезаний. Осталось вживую: падение процесса и обрыв связи с Discord в логе (код есть, но вживую не воспроизводились), страница на настоящей админке.
<!-- SECTION:NOTES:END -->
