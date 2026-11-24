# Транспорт

**Назначение:** внешние контракты модуля — форма команды и ответа, HTTP, MCP, in-proc. Генераторы транспорта — потребители графа (`dmg-core/graph`); в пакете пока не входят. Решения — D-17, D-28, D-46, D-49, D-56, D-57 ([decisions.md](../decisions.md)).

---

## 1. Общее

- Транспорт **генерируется** из Def: роутинг, валидация, описание контракта. Ручных ручек нет.
- Ответ — сериализованный `Result`:
  ```json
  { "ok": true, "value": { } }
  { "ok": false, "error": { "code": "TASK_ALREADY_DONE", "kind": "conflict", "payload": { } } }
  ```
- Сериализует и восстанавливает ответ Def UC: `serializeResult` / `restoreResult`; ошибка — без `label`/`description`, их клиент берёт из Def ([errors-result.md](./errors-result.md) §2). Код или payload вне контракта UC → `SERVER_INTERNAL`.
- Выход UC — только простые данные: время — `Timestamp`-число; без `Date`, `Map`, `undefined` в значениях. Клиент выход повторно схемой не проверяет.
- Агрегаты передаются **снапшотом**; клиент восстанавливает их в `ReadonlyAr`.
- Маппинг `kind` → представление транспорта — **только в адаптере**.

## 2. HTTP

- Всегда `POST /api/<module>` с телом JSON-команды:
  ```json
  { "uc": "completeTask", "input": { "taskId": "…", "expectedVersion": 3 }, "meta": { "requestId": "…" } }
  ```
- Команда — простые данные: `uc` — `name` Def UC, имени модуля в ней нет. Клиент собирает её из Def: `ucDef.command(input)` → `Command<D>`.
- `meta` — расширение без смены протокола: `requestId`.
- Caller и `Trace` в команду не входят: их передаёт транспорт (заголовки, токен); заявка делегирования (`DelegationClaim`) — тоже, резолвер приложения проверяет её на каждом запросе (D-89).
- **Модуль адресует URL:** `apiApp` выбирает `apiModule` по `<module>`, тот исполняет `dispatch(command, caller, trace)` и находит UC по имени. Неизвестный модуль или UC → `Err` `OPERATION_NOT_FOUND` (`not_found`, payload `{ module, uc }`).
- `OPTIONS /api/<module>` — контракт модуля: UC с JSON Schema входа и выхода, ошибки, описание политики, `label`/`description`.

**Ожидаемая версия.** Поле входа UC `expectedVersion` (схема `F.expectedVersion('<агрегата>')`), а не `meta`. UC сверяет её шагом `this.expectVersion(ar, expectedVersion)`: расходится — `VERSION_CONFLICT` без записи; не прислана — сверки нет. Поле видно в `OPTIONS` и входит во вход отсева повторов.

**`requestId`.** Клиент создаёт его один раз на намерение и повторяет при ретраях; это и след (`Trace`, `correlationId`), и ключ идемпотентности command UC — отдельного ключа нет. Один `Trace` с id клиента — одна команда: новая команда — новый `requestId` и новый `Trace`; один след на разные команды даёт `REQUEST_CONFLICT` `reason: 'input'` (тот же вход — сохранённый ответ первой). В тестах — фабрика следа, а не константа: `const req = () => Trace.fromRequest({ requestId: crypto.randomUUID() })`.

**Отсев повторов** — в `dispatch` модуля, через порт `ReplayStore` (`AppContext.replay`; по умолчанию `InProcReplayStore`: TTL 24 ч и ёмкость; хранилище, переживающее рестарт, даёт приложение).

| Случай | Поведение |
|---|---|
| Отсеивается | command UC, `requestId` прислал клиент (`trace.clientRequestId`) |
| Не отсеивается | query; серверный `requestId`; след события или Job; вызывающий `system`; гость без `visitorId` |
| Ключ | модуль + вызывающий (`user` — субъект; `delegate` — субъект и заместитель; гость — канал и `channel.visitorId`) + `requestId` |
| Вход | канонический JSON `{ uc, input }`, ключи объектов отсортированы |
| Тот же вход | сохранённый `Ok` без исполнения UC, без Policy и лога операций; `info` в логгер |
| Другой вход | `REQUEST_CONFLICT`, `reason: 'input'` |
| Первый ещё исполняется | `REQUEST_CONFLICT`, `reason: 'in_progress'` |
| Сохраняется | только `Ok`; после `Err` или исключения запись снимается |
| Сбой процесса после `claim` | запись остаётся «в работе» до TTL: повтор получает `in_progress`, а не второе исполнение |
| Переполнение `InProcReplayStore` | старейшие записи забываются, в том числе «в работе»: повтор такого запроса исполнится снова |

- **`REQUEST_CONFLICT`** — `conflict` → 409, базовая ошибка ядра, payload `{ requestId, reason }`; `info` в логгер с причиной.
- Порт `ReplayStore`: `claim(key, input)` до исполнения атомарно проверяет и занимает ключ (запись «в работе») и выдаёт токен владельца; `key` и `input` строит `dispatch`. Своё хранилище (файл, общая БД) даёт атомарность блокировкой или сравнением с заменой: два параллельных `claim` не займут ключ оба. `complete(key, token, answer)` и `release(key, token)` действуют только для владельца: запись под ключом с другим токеном (прежняя истекла или вытеснена, ключ занял новый запрос) не трогают. Ответ — JSON-совместимые данные, хранилище отдаёт копию.
- Сбой хранилища (ERR-07): сбой `claim` — `SERVER_INTERNAL` и `error` в логгер, UC не исполняется; сбой `complete` или `release` — `error` в логгер, ответ UC возвращается как есть.

Маппинг `kind` → HTTP-статус (в адаптере):

| kind | Статус |
|---|---|
| `validation` | 422 |
| `unauthorized` | 401 |
| `access` | 403 |
| `not_found` | 404 |
| `conflict` | 409 |
| `internal` | 500 |

## 3. MCP

Цель по D-18, в пакете не реализовано: генератора MCP нет.

- UC → **tool**: `name` (`<module>.<uc>`), `description` из Def, `inputSchema` из JSON Schema; аннотации: query → `readOnlyHint`, command → `destructiveHint` по необходимости.
- Граф → **resources**: документ графа приложения ([graph.md](./graph.md)) и его срезы — карта модулей, страницы модулей и агрегатов, каталоги событий и ошибок.
- `Err` → результат tool с `isError`; текст — по умолчанию `ErrorText` ([errors-result.md](./errors-result.md) §2).
- Caller: только query, dev-окружение, явно заданный `user` (D-18).

## 4. In-proc

Форма та же, что у HTTP: команда `{ uc, input, meta? }` и `Result`; JSON-сериализации нет, объекты передаются как есть.

| Клиент | Вызов | Ответ |
|---|---|---|
| приложение в процессе (бот, story, CLI) | `apiApp.dispatch(moduleDef, ucDef.command(input), caller, trace)` | `Result<OutputOf<D>, UseCaseErrorOf<D>>` как есть |
| вызов по имени (`call <module>.<operation>` раннера каркаса) | `apiApp.dispatchByName(module, { uc, input }, caller, trace)` | `Result`; вход проверяет схема UC (`INPUT_VALIDATION`) |
| клиент вне процесса (web UI, другой сервис) | `moduleApi.dispatch(ucDef.command(input), caller, trace)`; `ModuleApi` (`dmg-core/app`) — Def модуля и `CommandTransport` | `Result`, восстановленный по Def UC; ошибка вне контракта — `SERVER_INTERNAL` и `warn` с исходным `code` (ERR-07) |
| другой модуль | фасад `ModuleFacade` (D-43) — сахар поверх команды | `Result`; `ReadonlyAr` строит вызывающий |

- `apiApp.dispatch` по Def — обёртка над `dispatchByName`. Команда UC другого модуля — ошибка компиляции; модуль не подключён или UC не найден — `OPERATION_NOT_FOUND`.
- Caller и `Trace` — явные аргументы, их строит раннер.
- `CommandTransport`: `send(module, command, caller, trace)` → `SerializedResult`; caller и trace транспорт переводит в токен и заголовки. Реализаций транспорта в пакете нет.
- Вынос модуля в сервис (D-28) предусмотрен, но шва нет: `apiApp` строит фасад зависимости только из модуля своего процесса, удалённого подключения нет (`DEBT-5` реестра долга пакета). Вызов модуля вне процесса — `ModuleApi`.
- Видимость UC для вызова по имени — `callers` и Policy, не `contract.ts` (D-54).
