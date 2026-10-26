---
id: TASK-53
title: 'Света: уровень обдумывания в админке'
status: In Progress
assignee: []
created_date: '2026-10-26 19:32'
updated_date: '2026-10-26 19:36'
labels: []
dependencies: []
priority: low
ordinal: 31000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Насколько модель Светы «думает» перед ответом, было зашито в коде на «низко» (Gemini 3 thinkingLevel LOW, OpenRouter reasoning.effort low). Владелец хочет менять это на странице «Света»: выше — продуманнее и, возможно, смешнее, но медленнее и дороже.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 На странице «Света» можно выбрать уровень обдумывания: низкий, средний или высокий; по умолчанию — низкий, как раньше; изменение действует без перезапуска
- [x] #2 Выбранный уровень уходит в запрос и к Gemini 3 (thinkingLevel), и к моделям OpenRouter (reasoning.effort); у Gemini 1.x и 2.x запрос не меняется
- [x] #3 Неизвестный уровень не сохраняется — понятная ошибка; автотесты и документация обновлены
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. gemini.ts: THINKING_LEVELS low|medium|high, GeminiRequest.thinking; requestBody — thinkingLevel по уровню (Gemini 3+), openrouter.ts — reasoning.effort.
2. botSettings: sveta.thinking (умолчание low) + проверка; index.ts передаёт s.thinking.
3. API (sveta section, apiTypes) и Select на странице «Света».
4. Тесты, typecheck, check:admin, build; guide, development, CLAUDE.md.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Сделано по плану: три уровня (у Gemini 3 обдумывание не выключить, «minimal» Gemini 3.8 Flash не принимает). Проверено: pnpm test 270/270 (requestBody — MEDIUM из настройки, у 2.x без thinkingConfig; openRouterBody — effort high; index передаёт sveta.thinking; неизвестный уровень — ошибка), typecheck, check:admin, build; браузер на подставном API: выбор «Обдумывание» на странице «Света», «Высокое» сохраняется (thinking: high), страница без переполнения. Вживую на dev не проверено.
<!-- SECTION:NOTES:END -->
