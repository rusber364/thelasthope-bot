---
id: TASK-52
title: 'Света: расход токенов и стоимость по моделям в админке'
status: In Progress
assignee: []
created_date: '2026-10-26 16:57'
updated_date: '2026-10-26 17:06'
labels: []
dependencies: []
priority: medium
ordinal: 30000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Владелец хочет подключать Свете новые модели (в том числе платные через OpenRouter) и сразу видеть, сколько они расходуют и бесплатны ли. Сейчас токены видны только в «Логе бота» у каждого ответа, причём у ответа с инструментами — только у последнего запроса; за день считаются лишь запросы, без разбивки по моделям.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Каждый запрос к модели учитывается за день по Киеву отдельно для каждой модели: число запросов, токены на вход и на выход, стоимость, если её прислал сервис (OpenRouter)
- [x] #2 На странице «Света» видно расход за сегодня и таблицу по моделям за последние 7 дней; у бесплатной модели OpenRouter видно, что она ничего не стоит, у Gemini — что стоимость сервис не сообщает
- [x] #3 Строка ответа в «Логе бота» показывает токены всех запросов ответа (вход → выход) и стоимость, если она есть
- [x] #4 Автотесты покрывают разбор расхода из ответов Gemini и OpenRouter, накопление по моделям и ответ API; документация обновлена
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. gemini.ts/openrouter.ts: GeminiReply.usage {input, output, cost} вместо tokens (Gemini: promptTokenCount и total − prompt; OpenRouter: prompt_tokens, completion_tokens, cost).
2. db.ts: таблица sveta_model_usage (day, model, requests, input_tokens, output_tokens, cost); limits.ts: countSpend / spendSince.
3. index.ts: копить расход по моделям за ответ (попытки — onAttempt, токены — ответы), писать в finally; строка лога с суммой.
4. svetaStatus: spend за 7 дней; apiTypes.
5. Админка «Света» → «Подключение»: токены сегодня и таблица по моделям за 7 дней.
6. Тесты, typecheck, check:admin, build; guide, checklist, development, CLAUDE.md.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Сделано по плану. Проверено: pnpm test 269/269 — sveta.test.ts (usage из ответа Gemini: вход 60, выход 17 с «мыслями», стоимость null; расход по моделям: инструментальный ответ платной модели = 2 запроса, 300 → 30 токенов, $0.75, строка лога с суммой; две неудачные попытки основной + запасная Gemini без стоимости), openrouter.test.ts (prompt/completion/cost 0), api.test.ts (GET /api/sveta/status → spend); typecheck, check:admin, build; браузер на подставном API: таблица «Расход по моделям за 7 дней» (бесплатно / — / $0.00271), на 1000 px целиком, на 375 прокрутка внутри блока без переполнения страницы. Вживую на dev-боте не проверено — чек-лист «Расход Светы по моделям». Подпись «запросов к Gemini» в «Подключении» стала «запросов к моделям».
<!-- SECTION:NOTES:END -->
