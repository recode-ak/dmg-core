---
name: dmg-architecture
description: ЗАГРУЖАТЬ ПЕРВЫМ при создании или редактировании модулей на dmg-core (DMG) — домена, Def, Ar, Policy, UC/ER/Job, репозиториев, модулей. Говорит, где разместить логику, как назвать файлы и объекты, какой гайд и какие правила (ID из rules.md) проверить.
---

# DMG: как писать модуль на dmg-core

Источник истины — документация пакета `node_modules/dmg-core/docs/` (вход — `node_modules/dmg-core/llms.txt`). Скил — маршрутизатор: не дублирует документы, а говорит, что прочитать. Образец любого артефакта — учебный модуль `node_modules/dmg-core/src/testing/example` (`todo`, `users`).

## 1. Где разместить логику

1. Модуль-владелец и объект — `reference/domain-modeling.md` §1 (Ar / Policy / доменное правило / DCS / DQS / делегирование).
2. Ось и пакет, разрешённые импорты, доступ к entity — `reference/layers.md`.
3. Контракт (Def) — `reference/manifests.md`; ошибки и `Result` — `reference/errors-result.md`; кто вызывает — `reference/caller.md`; заместитель (делегирование между людьми) — `guides/delegation.md`.
4. Что допустимо в UC/ER/Job и как связаны модули — правила API и ARC в `reference/rules.md`.
5. Пакет-расширение (UI, адаптер): свой вид Def, поставщик графа, правило `arch:check`, слой исходников, подписка на события (`EventSubscriber`), текст отказа (`ErrorText`) — `guides/graph-extension.md`; формат графа — `reference/graph.md`. Свои скилы, роли и виды `gen` пакета — `providers` и `layers` в `.dmg/config.json`, `guides/provider-extension.md`.

## 2. Как назвать и где положить

Сокращения, суффиксы файлов, структура домена и прикладного слоя — `reference/naming.md`. Заготовки — генератором `dmg-core gen`, а не руками; раскладка корней — секция `gen`, `reference/gen.md`. Новый проект — каркас `dmg-core init --profile single|monorepo`; что он создаёт, как подключить модуль к приложению и кто что правит руками — `guides/project.md`.

## 3. Как написать артефакт вида

Гайд вида — `guides/index.md` (выбери вид, открой гайд): когда применять, команда генератора, образец в учебном модуле, чеклист ID, типичные ловушки, как тестировать.

## 4. Проверь перед завершением

- Применимые правила — `reference/rules.md` (в том числе карта линтера); правила поставщика графа — со своим префиксом.
- Тесты — `reference/testing.md`; `check` проекта зелёный.

## 5. Стоп-сигналы

Когда остановиться и вернуть эскалацию — раздел «Остановись и верни эскалацию» `node_modules/dmg-core/agents/common.md`.
