---
id: TASK-50
title: >-
  Света: модели OpenRouter (MiniMax M3.1 Flash free) — основная и запасная
  модель
status: In Progress
assignee: []
created_date: '2026-10-20 00:30'
updated_date: '2026-10-20 00:44'
labels: []
dependencies: []
priority: medium
ordinal: 28000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Бесплатный Gemini часто перегружен и упирается в лимиты. Владелец хочет подключить OpenRouter: там есть бесплатная MiniMax M3.1 Flash с инструментами — сделать её основной, Gemini запасной; сначала на dev-боте.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 В настройках Светы — «Основная модель» и «Запасная модель»; модель с «/» в имени идёт через OpenRouter (ключ OPENROUTER_API_KEY), без «/» — через Gemini
- [x] #2 Через OpenRouter работают инструменты Светы (сборы и память), ответ модели с вызовом возвращается в переписку как есть
- [x] #3 Перегрузка, лимит или таймаут основной модели — отвечает запасная (та же логика отдыха моделей)
- [ ] #4 Админка показывает, есть ли ключ OpenRouter, если он нужен выбранным моделям
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
config.openrouterApiKey (OPENROUTER_API_KEY). sveta.fallbackModel (умолчание gemini-flash-lite-latest), проверка имён моделей с «/» и «:». src/sveta/openrouter.ts: toMessages (Gemini → OpenAI, tool_calls / role tool с тем же id, raw как есть), openRouterBody (reasoning effort low, tools, tool_choice none на последнем круге), parseOpenRouter (текст без <think>, вызовы, raw с reasoning_details; ошибки → виды GeminiError), generateOpenRouter. generateSteady: модели основная+запасная, keyFor — свой ключ, модели без ключа пропускаются. index.ts: DEFAULT_DEPS.generate выбирает провайдера по isOpenRouterModel; svetaStatus.hasOpenRouterKey. Админка: «Основная модель» / «Запасная модель», строка ключа OpenRouter в «Подключении».
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Проверено: pnpm test 262/262 (openrouter.test.ts: перевод переписки, тело запроса, разбор ответа и ошибок, заголовок Authorization; sveta.test.ts: основная OpenRouter со своим ключом, при сбое — запасная Gemini, без ключа OpenRouter — сразу Gemini, без ключей — молчит; проверка имён моделей), typecheck, check:admin, build. Тест поймал не-ASCII в заголовке X-Title (fetch падал) — исправлено. Вживую не проверено: инструменты через MiniMax (AC 2), строка ключа в админке (AC 4) — чек-лист «Света на моделях OpenRouter».

20.10: выкачено на dev (efecdce), ключ OPENROUTER_API_KEY в .env dev, основная minimax/minimax-m3.1-flash:free, запасная gemini-flash-latest. Пробный запрос с сервера через generateOpenRouter: круг 1 — вызов upcoming_raids за 1,1 с, круг 2 (результат + raw) — ответ текстом за 1,4 с. Ключ: бесплатный аккаунт, 50 бесплатных запросов в день.
<!-- SECTION:NOTES:END -->
