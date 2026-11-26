---
covers:
  - src/testing/example/**
  - src/testing/example-provider/**
---
# Учебный модуль

**Назначение:** раскладка учебного приложения `src/testing/example` (модули `todo` и `users`) — образца всех артефактов в документации пакета; вход для тестов внешних пакетов — `dmg-core/testing/example`; фикстура поставщика `example-provider`.

---

## 1. Раскладка `src/testing/example`

Форма — `single` (D-106). Пути ниже — от `src/testing/example/`.

| Что | Путь |
|---|---|
| kernel | `platform/kernel/` |
| домен модуля | `platform/domain/<m>/` |
| реализация модуля | `backend/<m>/` |
| `AppDef` | `platform/domain/example.app.ts` |
| вход графа (`dmg-core graph`), `{ def }` | `example.graph.ts` |
| `ArchApp` (`{ ...ExampleGraph, layout, … }`) | `example.arch.ts` |
| сборка | `runners/assembly/example-app.ts` |
| раннер | `runners/cli/` |
| расширение графа и проверок: описание | `screen/` |
| расширение графа и проверок: исполнение | `screen-code/` |

Расширение графа и проверок (`screen/`, `screen-code/`) читается как образец, стабильным входом не является; как его писать — `guides/graph-extension.md`.

## 2. Вход для внешних пакетов

`dmg-core/testing/example` — учебное приложение для тестов пакетов-потребителей: `ExampleApp`, `ExampleAppDef`, типы `ExampleAppEnv`, `ExampleAppPorts`, `ExampleUser`, контракты модулей todo и users (D-101). Контракт todo отдаёт и `TaskAr`, `TaskPolicy`, `TaskRules`, `OPEN_TASKS_LIMIT` (D-104). Стабилен только этот вход: глубокие пути `dmg-core/testing/example/*` — нет. Исходники читаются как образец, зависеть от них нельзя. Остальные подпути пакета — `README.md`, «Подпути».

## 3. Фикстура поставщика `example-provider`

`src/testing/example-provider/` — образец пакета-поставщика скилов, ролей и видов `gen`: скил, роль и вид `example-unit`, вход `dmg-core.ts`. Как писать своего поставщика — `guides/provider-extension.md`.
