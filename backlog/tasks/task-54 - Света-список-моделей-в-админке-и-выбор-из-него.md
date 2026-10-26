---
id: TASK-54
title: 'Света: список моделей в админке и выбор из него'
status: In Progress
assignee: []
created_date: '2026-10-26 19:37'
updated_date: '2026-10-26 19:42'
labels: []
dependencies: []
priority: low
ordinal: 32000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Модель Светы вписывалась в поле руками: легко опечататься, а чтобы сравнить несколько моделей OpenRouter, приходилось каждый раз вспоминать их имена. Владелец хочет один раз добавить модели в список и потом просто выбирать основную и запасную.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 На странице «Света» есть список моделей: можно добавить модель по имени (Gemini или OpenRouter с «/») и убрать ненужную; выбранную основной или запасной убрать нельзя
- [x] #2 Основная и запасная модель выбираются из списка; запасная может быть «без запасной»; изменения действуют без перезапуска
- [x] #3 Текущие основная и запасная модели после обновления сами оказываются в списке; по умолчанию в нём gemini-flash-latest и gemini-flash-lite-latest
- [x] #4 Неверное имя, повторы и слишком длинный список отсекаются понятной ошибкой; автотесты и документация обновлены
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. botSettings: sveta.models (≤ 20, умолчание — две Gemini); getSettings дописывает в список основную и запасную; validateSettings — формат, основная и запасная в списке.
2. api.ts: models без повторов и пустых; apiTypes.
3. sveta.tsx: блок «Модели» (метки с видом Gemini/OpenRouter, убрать, поле + «Добавить»), Select основной и запасной.
4. Тесты, typecheck, check:admin, build, браузер; guide, development, CLAUDE.md.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Сделано по плану. Проверено: pnpm test 271/271 (botSettings.test: старые настройки без списка → умолчания + основная + запасная; ошибки: неверное имя, основная/запасная не в списке, > 20; sveta.test: OpenRouter-модель в списке без ошибок), typecheck, check:admin, build; браузер на подставном API: добавить «MiniMax/minimax-m3.1-flash» (Enter, имя → нижний регистр), метки Gemini/OpenRouter, выбрать основной, «Без запасной», крестик у основной и запасной недоступен, убрать лишнюю, «Сохранить» → models [gemini-flash-latest, minimax/minimax-m3.1-flash], model minimax, fallback пусто; ширина 375 без переполнения. Вживую на ботах не проверено.
<!-- SECTION:NOTES:END -->
