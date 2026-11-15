---
covers:
  - src/graph/graph-provider.ts
  - src/graph/graph-rule.types.ts
  - src/graph/kind-registry*.ts
  - src/graph/graph-error*.ts
  - src/graph/graph.ts
  - src/graph/graph-builder.ts
  - src/graph/domain/domain-ids.ts
  - src/graph/domain/graph-app.types.ts
  - src/arch/provider-rule-checker.ts
  - src/arch/violation.ts
  - src/app/events/event-subscriber*.ts
  - src/app/uow/declared-set*.ts
  - src/kernel/def/**
  - src/kernel/errors/error-text*.ts
  - src/testing/example/screen/**
---

# Расширение графа и проверок — гайд

**Назначение:** как пакет-поставщик (UI, адаптер, размещение) добавляет в приложение свой вид Def, узлы и рёбра графа, правила `arch:check` и подписку на события — снаружи `dmg-core`, только через публичные входы. Образец — экран приложения UI в `src/testing/example/screen/`. Формат графа — [reference/graph.md](../reference/graph.md).

---

## 1. Когда применять

- Пакету нужны свои узлы в графе приложения и связи с доменом (экран вызывает UC, слушает событие) и свои инварианты, видимые только на графе целиком.
- Домен уже поставщик (`dmg-core`): Def домена пишутся по своим гайдам ([index.md](./index.md)), не этим.
- Агрегат модуля меняется в ответ на событие — ER ([event-reaction.md](./event-reaction.md)); внешний слой только читает или вызывает UC — подписка `EventSubscriber` (шаг 6).

## 2. Команда

Генератора нет: файлы пишутся по образцу. Проверка — `dmg-core graph <вход графа> --out <путь>` (документ собирается, код 0) и `bun run arch:check` (правила поставщика в отчёте).

## 3. Шаги

1. **Вид Def** — наследник `Def` (корень `dmg-core`): свой `dmg`, свои поля, `static define` (у базы его нет), `normalize()` — `{ dmg, ...texts(), visible, свои поля }`, ссылки на Def — именами. Структурный тип `Any<Вид>Def` и спека — в `*.types.ts`.
2. **Виды** — данные `GraphKinds`, как `DOMAIN_KINDS`: свои имена видов узлов и рёбер, схема `props` (valibot) необязательна (без неё `props` — `{}`).
3. **Поставщик** — `implements GraphProvider`: `name` уникален (имя пакета), `version` — версия пакета; `AppDef` и Def — в конструктор, `contribute()` без аргументов. Свой корень (приложение UI — не часть доменного приложения), узлы — под ним; `label`, `description`, `visible` — из Def. Форма вклада (`GraphNodeInput`, `GraphEdgeInput`; `parent` и `provider` не передаются) — [graph.md](../reference/graph.md) §1. Ссылки на узлы домена — только `new DomainIds(appDef)`: `operation(uc)`, `event(e)` и др.
4. **Правило** — `GraphRule = { id, check(graph) }`: `check` возвращает сообщения без ID, ID приписывает `arch:check`. ID — `<ПРЕФИКС>-<NN>` (`^[A-Z][A-Z0-9]+-\d{2}$`), префикс — свой (ARC-13). Отбор узлов по `kind` и `graph.outgoing(id, kind)` — запрос к графу, не ветвление по виду Def (D-48). `rules?()` у поставщика необязателен.
5. **Вход графа и проверки** — один список поставщиков (D-97): вход `{ def: <Имя>AppDef, providers: [new <Вид>Provider(...)] }` с `export default` (для `dmg-core graph`), конфиг проверок — `ArchApp = { ...<Имя>Graph, entry, layout, root, runners }`. Правила берутся только у `providers`; каркас `init` собирает `scripts/arch-check.ts` так же ([project.md](./project.md) §3).
6. **Подписка** — `new EventSubscriber(context, source)` (`dmg-core/app`; `bus` и `logger` из `AppContext` корня сборки; `source` — кто подписан). `on(def, handler)` возвращает отписку; обработчик `TracedHandler` получает конверт и след `Trace.fromEvent(envelope)`. Вызывающего выбирает обработчик: канал (экран) открыт пользователем — обработчик пропускает чужие события и разбирает этого пользователя резолвером с тем же `trace`; без пользователя — гость или явный `SystemCaller` с `from.kind: 'app'`. Повторная подписка того же канала удваивает вызовы — подписывай один раз и храни отписку. UC — `api.dispatch(module, UseCaseDef.commandOf(def, input), caller, trace)`: в логе операций причина — событие. Отсева повторов нет. Сбой обработчика — `logger.error(source, 'обработчик события <имя> упал: …')` без payload. Канал закрылся — `close()`.
7. **Только объявленное** — `DeclaredSet` (`dmg-core/app`): `new DeclaredSet(def.listens)`, `assert(item, message)` сверяет по идентичности; без обработчика нарушения — `throw new Error(message)`, синхронно до вызова; список `undefined` — объявлено всё.
8. **Текст отказа** — `ErrorText.of(error)` (корень `dmg-core`): `summary`, `fields`, `toString()`, правила по `kind` — [errors-result.md](../reference/errors-result.md) §2. Это текст по умолчанию: адаптер вправе дать свой (D-99).

## 4. Образец

- [screen-def.ts](../../src/testing/example/screen/screen-def.ts): `ScreenDef extends Def` — `uses` и `listens` ссылками, в форме — именами; [tasks.screen.ts](../../src/testing/example/screen/tasks.screen.ts) — манифест экрана.
- [screen-kinds.ts](../../src/testing/example/screen/screen-kinds.ts): поставщик `example-screen`, корень `example-ui`, виды `uiApp`, `screen`, `uses`, `listens`.
- [screen-provider.ts](../../src/testing/example/screen/screen-provider.ts): узлы и рёбра через `DomainIds`; [screen-rule.ts](../../src/testing/example/screen/screen-rule.ts) — правило образца `SCR-01` «экран без UC».
- [screen.graph.ts](../../src/testing/example/screen/screen.graph.ts) и [screen.arch.ts](../../src/testing/example/screen/screen.arch.ts): вход графа и `{ ...ExampleArch, ...ScreenGraph }`.
- [screen-session.ts](../../src/testing/example/screen/screen-session.ts): `EventSubscriber` + `DeclaredSet`; [tasks-screen.ts](../../src/testing/example/screen/tasks-screen.ts) — `new TasksScreen(session, callers, userId)`: события своего пользователя, вызывающий — он через резолвер, ответ последнего запроса, отказ — список прежний.

## 5. Чеклист правил

- ARC-04, ARC-08 — домен — через `contract`, платформа — через публичные входы (`dmg-core`, `dmg-core/app`, `dmg-core/graph`, `dmg-core/arch`); UC — только `api.dispatch`.
- ARC-13 — свой префикс ID, не из префиксов пакета (`PACKAGE_RULE_PREFIXES`), один префикс — один поставщик.
- CODE-01 — типы вида и спеки — в `*.types.ts`; CODE-04 — JSDoc до 6 строк, `D-NN` — в шапке юнита.
- TST-08, TST-09 — тест расширения проверяет своё (вид, вклад, правило, сессию) и один сквозной сценарий; подъём рёбер, отписку и лог сбоя `EventSubscriber`, сверку `DeclaredSet` проверяет пакет.

## 6. Типичные ловушки

- Вид с именем вида домена (`module`, `useCase`) → `duplicate-kind`; поставщик с именем `dmg-core` → `duplicate-provider`. Свои имена.
- Узлы под корнем доменного приложения (`example/<экран>`) → совпадение с модулем, `duplicate-node`. С правилами у поставщика это нарушение ARC-13 «граф … не собран», правила не выполняются; без правил ошибку покажет только `dmg-core graph` (код 1). Свой корень.
- Ссылка на домен строкой (`'example/todo/listTasks'`) → `DomainIds`: опечатка или переименование не роняет сборку, ребро молча уходит во внешние ссылки.
- Бросок в `check` правила → `arch:check` падает исключением, оно не перехватывается: нарушение — строкой в ответе.
- Неверный ID (форма, префикс пакета, чужой префикс, повтор) → исключение уже в `ArchChecker.of`, `reportArchCheck` его не ловит.
- Поставщик добавлен в `ArchApp`, а не во вход графа → в `graph.json` его нет; держи один список (шаг 5).
- Команда из обработчика в расчёте на отсев повторов → его нет: идемпотентность — забота обработчика.
- Вызывающий — владелец события (`payload.ownerId`) → экран пользователя X покажет данные Y от имени Y. Вызывающий — пользователь канала (экрана), чужие события пропускаются.
- Асинхронные обработчики завершаются не по порядку → применяй ответ последнего запроса (счётчик запросов), а не пришедший последним.
- Payload с полями `F.sensitive` пересылается во внешний канал как есть; данные события в тексте исключения обработчика → текст уходит в лог.

## 7. Как тестировать

Приёмочный тест расширения — [screen.test.ts](../../src/testing/example/screen/screen.test.ts): форма `normalize()` вида; узел, `provider` и рёбра в `new AppGraph(<Имя>Graph).build()`; `ArchChecker.of(<Имя>Arch).check()` пуст; нарушение правила в `reportArchCheck` (код 1, строка `<ID>: …`); подписка вызывает UC и цепочка видна в логе операций (`AwaitingBus`, `MemoryLogger`, временный каталог); необъявленные UC и событие — отказ; `document(version).serialize()` двух сборок равны. Общее — [testing.md](../reference/testing.md).
