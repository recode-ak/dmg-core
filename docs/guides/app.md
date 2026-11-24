---
covers:
  - src/app/api-app/**
  - src/app/context.ts
  - src/gen/kinds/app-wiring.ts
verified: 269f105
---

# Сборка и раннер — гайд

**Назначение:** сборка (корень сборки) — класс приложения в пакете `runners/assembly`, который по окружению `AppEnv` строит `AppContext`, хранилища и модули через `ApiApp` и отдаёт резолвер `Caller` (D-50, D-106); раннер-процесс — точка входа рядом с ней, `runners/<r>`: `process.env` → `AppEnv`, транспорт, `Trace`, запуск и остановка. Оба — ось раннеров: что, где и на чём запущено ([layers.md](../concepts/layers.md)).

---

## 1. Когда применять

- Сборка — одна на состав процесса: все модули собираются в ней, раннеры-процессы (бот, HTTP, CLI) получают готовое приложение. Модули раннер-процесс не собирает и фасады руками не раскладывает — это делает `ApiApp` по `dependsOn` (цикл, отсутствующая зависимость, повтор — исключение сборки). Сервис из одного модуля объявляет свою сборку со своим составом и хранилищем ([extract-module.md](./extract-module.md)).
- Сборка выбирает технологии: хранилища, шину, лог операций; платформа приложения (`kernel`, домен) о них не знает. Репозитории лежат в пакете реализации модуля, а какой взять и где хранить — решает сборка в фабрике модуля.
- Окружение — простые данные (режим, каталоги, параметры хранилищ); порты (шина, логгер, часы) подменяются отдельным аргументом для тестов, а не через окружение.
- Вызов UC снаружи модуля в процессе — `api.dispatch(moduleDef, ucDef.command(input), caller, trace)` (D-49); вне процесса — `ModuleApi` ([transport.md](../reference/transport.md) §4). Межмодульный вызов изнутри модуля — фасад ([facade.md](./facade.md)).
- Запуск Job по расписанию — не часть `ApiApp`: приложение создаёт `InProcJobScheduler({ api, modules, clock, logger })`, вызывает `start()` при старте и `stop()` при остановке (D-71, [job.md](./job.md#7-запуск-по-расписанию)).
- `Caller` строит резолвер приложения (по uuid из транспорта или его отсутствию), канал и `Trace` — раннер. Свой вызов UC сборка делает от `SystemCaller` с `from.kind: 'app'` (D-51).

## 2. Команда

`dmg-core init --profile single|monorepo` создаёт сборку (`runners/assembly`: `app.ts`, `app.types.ts`, резолвер `Caller`, тест) и раннер CLI (`runners/cli` : окружение, `runner-cli.ts`, `main.ts`, тесты) — [project.md](./project.md). Модули к сборке подключает генератор по маркерам (`gen module`, `gen aggregate`). Раннер CLI вызывает любой UC командой `call <module>.<operation>` (`api.dispatchByName`); в каркасе остаётся `TODO` — резолвер с пользователями вместо заглушки (`--user <uuid>` → `UserCaller` без ролей, только канал `cli`; [project.md](./project.md) §3).

## 3. Образец

- [example-app.types.ts](../../src/testing/example/runners/assembly/example-app.types.ts): `ExampleAppEnv` — только данные; `ExampleAppPorts` — подмена шины, логгера и часов.
- [example-app.ts](../../src/testing/example/runners/assembly/example-app.ts): `AppContext` на `InProcEventBus`, `InProcOutbox`/`InProcInbox`, `InProcReplayStore` (часы приложения), `ConsoleLogger`, `JsonlOperationLog` (опции `maxBytes`, `valueMaxBytes`, `retainDays` и чтение лога — [oplog.md](../reference/oplog.md)); фабрики модулей из входов пакетов (`backend/<m>/index.ts`) с замыканием на репозитории; `start()` → `api.subscribe()`, возвращает остановку.
- [example-caller-resolver.ts](../../src/testing/example/runners/assembly/example-caller-resolver.ts): `getUser` через `api.dispatch`; нет пользователя → `GuestCaller`, прочие `Err` — исключение (ошибка конфигурации); с заявкой делегирования — `DelegateCaller` или `DELEGATION_DENIED` в `Result` ([delegation.md](./delegation.md)).
- [example-cli.ts](../../src/testing/example/runners/cli/example-cli.ts): argv → `Result` разбора → `Trace` (канал `cli`) → резолвер → одна точка `dispatch`; коды выхода 0 / 1 (ввод) / 2 (отказ UC).
- [example-env.ts](../../src/testing/example/runners/cli/example-env.ts) и [main.ts](../../src/testing/example/runners/cli/main.ts): `process.env` → `ExampleAppEnv` — единственное место чтения окружения.
- [example.arch.ts](../../src/testing/example/example.arch.ts): каталоги слоёв в `ArchApp` — сборка, kernel, домен и реализации из `layout`, раннеры-процессы — `runners`; их импорты проверяет `arch:check` (D-107).
- [example.app.ts](../../src/testing/example/platform/domain/example.app.ts): `AppDef` — манифест состава приложения; в конфиг проверок `ArchApp` поле `def` приходит через вход графа (`{ ...ExampleGraph, entry, project, layout, runners, graphEntry }`; `graphEntry` — путь к файлу входа графа, D-108).

## 4. Чеклист правил

- ARC-07 — сборка импортирует фреймворк, `kernel`, контракты домена, `backend/app` и входы (`index`) пакетов реализации; внутрь пакета реализации — нет (D-52).
- ARC-08 — раннер-процесс импортирует сборку, `kernel`, контракты домена и фреймворк; пакеты реализации и `backend/app` — нет; операции — только через `api.dispatch`.
- ARC-09 — `process.env` читает только точка входа раннера; сборка получает `AppEnv`.
- ARC-05 — граф `dependsOn` без циклов: `ApiApp` проверяет его при сборке.
- ERR-01 — ошибка сборки и конфигурации (нет зависимости, неверное окружение, модуль не подключён в резолвере) — исключение, а не `Result`.

## 5. Типичные ловушки

- Резолвер превращает любую ошибку в гостя — дефект конфигурации прячется за отказом в правах; гость — только «нет пользователя».
- Раннер-процесс собирает модули или импортирует `backend/<m>/…` — сборка дублируется по раннерам, транспорт достаёт репозиторий мимо UC (ARC-08); раннер берёт только сборку.
- Дефолтный каталог данных от текущего каталога — данные появляются в рабочем дереве; каталог — обязательная переменная окружения.
- Порты в окружении (`AppEnv` с объектами) — окружение перестаёт быть данными; подмена — вторым аргументом.
- Реакции не подписаны: `start()` не вызван в точке входа — события публикуются, но никто не реагирует.

## 6. Как тестировать

Сборка — во временном каталоге ОС, шина `AwaitingBus` из `dmg-core/testing` (доставка без таймеров): сборка и фасад по `dependsOn`, запись в oplog, резолвер (известный, неизвестный, удалённый, модуль не подключён), реакция после `start()` и её отсутствие после остановки ([example-app.test.ts](../../src/testing/example/runners/assembly/example-app.test.ts)). Раннер — `run(argv, io)` с буфером вместо `console`: коды выхода, ошибки ввода без вызова UC ([example-cli.test.ts](../../src/testing/example/runners/cli/example-cli.test.ts)); точка входа — отдельным процессом ([main.test.ts](../../src/testing/example/runners/cli/main.test.ts)). См. [testing.md](../reference/testing.md).
