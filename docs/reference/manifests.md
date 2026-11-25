# Манифесты

**Назначение:** семейство Def (`XxxDef.define`), обязательные поля, схемы, граф и проверки соответствия кода декларациям. Решения — D-12, D-35, D-42, D-43, D-48, D-49, D-93, D-94, D-95, D-97 ([decisions.md](../decisions.md)). Реализация — `src/` пакета; публичные экспорты — `src/index.ts` и подпути (`app`, `graph`, `arch`, `testing`).

---

## 1. Семейство

| DSL | Где | Что декларирует |
|---|---|---|
| `AppDef.define` | domain | доменное приложение (D-93): `name`, `label`, `description`, `visible?`, `modules` — полный состав (ссылки на `ModuleDef`, в форме — имена), `scale?` — метка масштаба (слово словаря проекта); размещения, раскладки и версии нет |
| `ModuleDef.define` | domain | `name`, `label`, `description`, `dependsOn`, состав (агрегаты, UC, ER, Job); `external: true` — модуль вне приложения (ещё не переведённый код, другой сервис): только контракт (события, Def UC без реализации), события публикует внешняя сторона |
| `AggregateDef.define` | domain | схема entity, статусы и переходы (`from`, `to`, `rejects` — отказ для каждого статуса вне `from`), группы событий и ошибок; класс `Aggregate` — база для Ar |
| `EventDef.define` | domain | группа событий агрегата (словарь `EventDef`): FQN-префикс `module.aggregate`, на событие — `label`, `description`, схема payload |
| `ErrorDef.define` | domain | группа ошибок агрегата (словарь `ErrorDef`): `code`, `kind`, `label`, `description`, схема payload |
| `PolicyDef.define` / `Rule.of` | domain | вопросы «можно ли?» → правила над субъектом: именованные (`Rule.of`, `Rule.hasRole`) с `label` и `denyMessage`, композиция `Rule.allOf`/`Rule.anyOf`, явное `allowAll` |
| `RulesDef.define` / `DomainRuleDef.define` | domain | доменные правила без субъекта (D-40): `name`, `label`, `description`, `error` (ErrorDef своей группы), `check(ctx) → Result` |
| `UseCaseDef.define` | domain (контракт) | `type` (command/query), агрегат, `policy`, `rules` (доменные правила; их ошибки — в `errors`), `callers` и `personal` ([caller.md](./caller.md)), `calls` (Def UC других модулей с `'system'` в `callers`, D-42/D-43), `input`, `output`, `errors`, `emits`. Клиенту: `command(input)` — команда (D-49), `serializeResult`/`restoreResult` — ответ для транспорта |
| `EventReactionDef.define` | domain (контракт) | `on` (события), `touches` (агрегаты), `calls` (Def UC других модулей, D-43), `emits` |
| `JobDef.define` | domain (контракт) | `schedule`, `scans`, `calls` (Def UC других модулей, D-43), `emits` |

Реализации подключают Def через базовые классы (`UseCaseFromDef`, `ReactionFromDef`, `JobFromDef` — наследники `OperationFromDef` с типизированным `call`, D-43; `ModuleFromDef` — единственная точка входа модуля, `handle`/`runJob` — карта `Def → класс`, типизированная Def: пропуск реализации — ошибка компиляции). Фасад — рантайм-граница без манифеста (`Facade<M>`/`ModuleFacade<M>`, D-42, D-43). Свойства Def в классах **не дублируются**.

**Def — классы** (D-48): общая база `Def` (`name`, `label`, `description`, `visible`) с поведением вида — `normalize()` (форма графа и хеша) и `describe()` (тексты и схемы для MAN-01/02/03; схемы вид отдаёт в `schemas()`), `texts()` — тексты для нормализованной формы. Новая возможность Def — метод вида, а не `switch` по `dmg`. Def сравниваются по ссылке, `private`/`#` у них нет: типизация `Any*Def` структурная. База и класс `Def` экспортируются из корня: чужой вид — наследник `Def`, `normalize` графа принимает и его.

**Признаки** (D-94) — только записываются, логики на них в пакете нет; оба по умолчанию `false` и всегда есть в нормализованной форме сразу после текстов: `visible` — Def виден пользователю приложения (у любого Def, в спеке `visible?`); `exposed` — публичный контракт модуля (только `UseCaseDef` и `EventDef`). В `texts()` и `describe()` признаков нет.

**Операции** (UC, ER, Job) — наследники `OperationDef`: `calls` есть у всех (не объявлены — пустой кортеж), `aggregates()` (агрегат UC, `touches` ER, `scans` Job), `mainAggregate()` (папка файла операции), `referencedErrors()` (`errors` UC), `subscribedEvents()` (`on` ER), `title(module)` (`UC todo.createTask` — для сообщений проверок), `fileKind` (`uc`/`er`/`job` — каталог и суффикс файла). Проверки графа и файлов работают с любой операцией через эти методы. Необъявленные списки спеки (`rules`, `emits`, `touches`, `scans`) Def тоже хранит пустыми кортежами.

**Ссылки, не строки:** `on: UserEvents.removed`, `errors: [TaskErrors.ALREADY_DONE]`. Строковые имена (FQN) вычисляются для шины, логов и документации.

**Обратные связи** (какие UC управляют агрегатом, кто слушает событие) не пишутся — их вычисляет граф.

**Жизненный цикл — только в Def.** Метод Ar меняет статус через `this.transition('<op>', at, apply)`: база проверяет `from`, возвращает отказ из `rejects` и ставит `to`; `apply` пишет только суть операции. `this.change(at, apply)` статус не меняет. Проверки статуса в методах Ar не дублируются (D-35, MAN-12).

## 2. Обязательные описания

- `label` — короткое имя (кнопка, заголовок, строка таблицы);
- `description` — для PO и LLM: что делает, когда применять. Обязательно для всех Def;
- `v.description()` на **каждом поле** схем input/output/entity/payload (базовые `F.*` ставят его сами из метки).

## 3. Схемы

- Базовые поля — только через `F.*` (core), `shared/` модуля домена и `kernel` приложения: `F.uuid('задачи')`, `F.timestamp('завершения')`, `BaseEntityFields`. Новые валидаторы для тех же полей не создаются.
- Схемы input/output/payload **конвертируются в JSON Schema** (`@valibot/to-json-schema`): без непереводимых `transform`/`custom` либо с явным fallback. Основа OPTIONS и MCP.
- DTO-схемы выводятся из схемы entity (`v.pick`, `Schema.entries.x`), а не пишутся заново.

## 4. Граф

Граф приложения строят поставщики: домен — `DomainProvider` по `AppDef` (узлы — Def с `id`-путём от приложения), другие пакеты — свои виды. Виды узлов и рёбер, дерево `id`, документ `.dmg/graph.json` — [graph.md](./graph.md).

Уровни просмотра (карта модулей, модуль, агрегат) — не отдельные структуры, а глубина подъёма одного графа: `graph.liftToKind('module')` — связи модулей, `graph.liftToDepth(n)` — приставка `id`.

## 5. Декларация + верификация (D-12)

Контрактные проверки — `ArchChecker` (`dmg-core/arch`: состав и тексты `AppDef` — MAN-01, MAN-15; проверки Def — описания, связи, граф `dependsOn`; с приложением — файлы модулей (при `ArchApp.layout`: файл модуля — ARC-06, файлы операций — MAN-06, MAN-10), импорты по слоям (ARC-02, ARC-04, ARC-06, ARC-07, ARC-08, TST-07), единицы выноса (ARC-14…ARC-16), правила и слои поставщиков графа — ARC-13, [graph.md](./graph.md); с `ArchApp.debt` — отступления от правил слоёв поставщика по реестру долга, ARC-12, D-111) в `check` проекта; каждое сообщение начинается с ID правила ([rules.md](./rules.md)).

| Декларация | Проверка |
|---|---|
| `errors` UC | тип: `this.err()` принимает только заявленные коды |
| `input` / `output` | тип + рантайм-валидация в `handle()` |
| `emits` UC/ER/Job | рантайм-ассерт в test/dev: незаявленное событие — ошибка |
| `touches` / `calls` ER | рантайм-ассерт через прокси резолвера в тестах |
| `dependsOn` | контрактный тест: фактические импорты и ссылки Def ⊆ `dependsOn`; граф — DAG |
| FQN событий | контрактный тест: префикс совпадает с модулем и агрегатом |
| связность | контрактный тест: нет висячих подписчиков, неопубликованных событий, Def вне модуля |
| описания | контрактный тест: непустые `label`/`description`, описания полей |
| JSON Schema | контрактный тест: все input/output/payload конвертируются |
| пары контракт ↔ реализация | контрактный тест: одинаковые пути ([naming.md](./naming.md)) |
