---
id: TASK-17
title: Живой список ближайших рейдов
status: Done
assignee:
  - '@claude'
created_date: '2026-10-15 22:21'
updated_date: '2026-10-16 11:58'
labels:
  - этап-2
  - среднее
  - raid-helper
  - рейды
dependencies: []
references:
  - 'https://raid-helper.dev/premium/'
priority: medium
ordinal: 800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Raid-Helper Premium показывает обновляемый обзор всех событий. Игрокам удобно видеть все реги в одном месте.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 В выбранном канале одно сообщение со всеми открытыми регами: дата, название, X/размер, ссылка
- [x] #2 Сообщение обновляется при записи, создании, отмене и закрытии рег
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Настройка raids.boardChannelId и выбор канала в админке («Расписание рег»).
2. raids/board.ts: buildBoard (чистая), refreshBoard (создать / обновить / перенести / убрать сообщение; id в таблице raid_boards), requestBoardRefresh с задержкой 1,5 с.
3. Обновление из publishRaid и refreshRaidMessage (запись, отмена, закрытие), при запуске и после сохранения в админке.
4. Тесты, руководство, чек-лист.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Список — embed: название-ссылка, время (Discord-метки: у каждого свой часовой пояс, «через N»), записавшиеся/размер, «под вопросом», канал. Все изменения рег уже идут через refreshRaidMessage, поэтому подписка одна. Обновления склеиваются и не идут параллельно; если список не включён — таймеры не ставятся. Тесты src/raids/board.test.ts (3); всего 141/141, typecheck.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Живой список ближайших рейдов: в канале из админки одно сообщение со всеми открытыми регами (дата, название-ссылка, записавшиеся/размер, «под вопросом»), обновляется при создании, записи, отмене и закрытии рег, переносится при смене канала и публикуется заново, если его удалили. Проверено тестами board.test.ts (порядок, счётчики, правка того же сообщения, перенос, удаление, склейка обновлений) и полным прогоном 141/141; вживую — пункты в чек-листе.
<!-- SECTION:FINAL_SUMMARY:END -->
