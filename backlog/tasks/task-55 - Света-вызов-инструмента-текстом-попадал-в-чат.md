---
id: TASK-55
title: 'Света: вызов инструмента текстом попадал в чат'
status: In Progress
assignee: []
created_date: '2026-10-26 20:25'
updated_date: '2026-10-26 20:25'
labels: []
dependencies: []
priority: medium
ordinal: 33000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
26.10 на главном (модель x-ai/grok-4.7) Света дважды ответила в чат текстом вызова инструмента: «change_attitude» и «change_attitude: {"change": -12, ...}». Модель изредка пишет вызов текстом вместо настоящего вызова, а второй раз повторила за собой, потому что видела прошлый сбой в истории канала.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Ответ, который целиком состоит из вызова инструмента текстом, в чат не уходит: вызов выполняется (запись в память срабатывает), Света отвечает словами
- [x] #2 Прошлые такие сообщения Светы не попадают в переписку для модели
- [x] #3 В постоянных правилах есть запрет писать инструменты текстом; автотесты и документация обновлены
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
context.ts::textToolCall; index.ts — фильтр истории и обработка в цикле (toolMode NONE на повторе); строка в persona.ts; тесты; development.md, CLAUDE.md.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Воспроизвести с Grok не удалось (2 сценария — вызов пришёл правильно), сбой случайный. Исправлено защитно. Проверено: pnpm test 273/273 (textToolCall: форматы и обычный текст; onMessage: вызов текстом не уходит в чат, второй запрос toolMode NONE, отношение −12 записано, прошлый сбой не в переписке), typecheck. Не выкачено.
<!-- SECTION:NOTES:END -->
