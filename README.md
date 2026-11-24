# dmg-core

Платформа DMG (Domain Manifest Graph) для TypeScript и Bun. Каждая доменная сущность объявляется один раз манифестом (`XxxDef.define`), а из него выводятся типы, базовые классы, проверки архитектуры, граф приложения и транспорт. Домен чистый и синхронный, модули связаны только по `dependsOn`, поэтому каждый можно вынести в отдельный сервис.

Документация на русском. Образец всех артефактов — учебный модуль [`src/testing/example`](src/testing/example/example.arch.ts) (модули `todo` и `users`).

## Цели пакета

Платформа решает три боли: описание одной сущности в пяти-шести местах, скрытые связи между модулями и логику, размазанную по слоям вместо домена.

**Что даёт из манифеста** (D-01). Один `*Def` порождает всё остальное, поэтому расхождений между кодом и декларацией не бывает:

| Потребитель | Что получает |
|---|---|
| Программист | типы, базовые классы без boilerplate, `Result` с исчерпывающими ошибками |
| Транспорт (фронт↔бэк, сервис↔сервис) | автороутинг, автовалидацию, контракт модуля по запросу |
| PO / аналитик | доменную документацию: модули, агрегаты, статусы, каскады, ошибки |
| LLM (MCP) | UC как tools, доменный граф как resources |
| Контрактные тесты | проверку, что код соответствует декларациям (`ArchChecker`) |

**Как устроен код, который из этого вырастает:**

- **Четыре оси** (D-02): платформа (`dmg-core`, пакет приложения) → домен → прикладной слой (1:1 с модулем домена) → входные адаптеры. Импорты идут только в одну сторону ([layers.md](docs/reference/layers.md)).
- **Домен един, чист и синхронен** (D-03): вся предметка и все контракты (UC, ER, Job, фасады, модули) живут в домене, без IO; асинхронность — только `Loader<T>`.
- **Модуль готов к выносу в сервис** (D-28): межмодульно — только фасады и события по `dependsOn` (DAG). Модулю в другом репозитории нужны лишь контракты зависимостей, а сервис из одного модуля — то же приложение с одним `dependsOn`.
- **Декларация + верификация** (D-12): каждая декларация проверяется типом, рантайм-ассертом или контрактным тестом, а правила архитектуры (ARC, DOM, ERR, API, CODE) — линтером и `ArchChecker` с ID нарушений ([rules.md](docs/reference/rules.md)).
- **Штатный отказ — `Result`, а не `throw`** (D-13): ошибка знает свой `code` и нейтральный `kind`, транспортный маппинг остаётся в адаптерах.

Итог: доменная логика собрана в одном месте, границы модулей проверяются автоматически, а транспорт, документация и MCP-инструменты не пишутся руками. Реестр решений — [decisions.md](docs/decisions.md).

## Установка

Нужен Bun ≥ 1.3.1. `valibot` и `@valibot/to-json-schema` — peer-зависимости (каркас `init --profile` добавляет их сам).

## Быстрый старт: новый проект

Каркас — конфиги, `check`, корень сборки и раннер CLI — создаёт `init --profile` ([гайд проекта](docs/guides/project.md)). Сначала `bun add`, потом `init`:

```sh
mkdir school && cd school && echo '{ "name": "@acme/school" }' > package.json
bun add dmg-core                         # до публикации: bun add ./dmg-core-<версия>.tgz
bunx dmg-core init --profile single      # один пакет: src/platform, src/backend, src/runners
# или
bunx dmg-core init --profile monorepo    # пакеты platform/*, backend/*, runners/*
bun install && bun run check
```

Дальше — модули генератором; он же подключает их к приложению (корень сборки, файл `AppDef`, зависимость пакета модуля):

```sh
bunx dmg-core gen module todo --write
bunx dmg-core gen aggregate todo.task --write
bunx dmg-core gen uc todo.task create --write     # рабочий UC создания
bun install && bun run check                      # зелёный без ручных правок
bun run graph                                     # graph.json — документ графа приложения
APP_DATA_DIR=data bun src/runners/cli/main.ts call todo.create --user <uuid>   # single
APP_DATA_DIR=data bun runners/cli/src/main.ts call todo.create --user <uuid>   # monorepo
```

Дальше — смысл заготовок: поля state, операции Ar, схемы входа, `callers` и Policy UC (`TODO` в коде).

Подробно, с тем, кто что правит руками, — [docs/guides/project.md](docs/guides/project.md); приложение и раннер — [docs/guides/app.md](docs/guides/app.md).

## Быстрый старт: существующий проект

```sh
bun add dmg-core valibot @valibot/to-json-schema
bunx dmg-core init
```

`init` без профиля создаёт `dmg-core.json` и доставляет в проект скилы и роли агентов (по умолчанию — для Claude Code в `.claude/`). Ещё он добавляет в `AGENTS.md` ссылку на [`llms.txt`](llms.txt) — индекс документации для агентов. После обновления пакета выполни `dmg-core sync`; `dmg-core sync --check` в `check` проекта падает, если копии устарели. Каркас `init --profile` делает то же и сверх того.

1. **Модуль.** `bunx dmg-core gen module todo --write` создаёт паспорт модуля в домене (`src/platform/domain/todo/`) и прикладной слой (`src/backend/todo/`). Без `--write` команда только печатает план. Каталоги и импорт домена задаёт секция `gen` в `dmg-core.json` ([naming.md](docs/reference/naming.md) §5).
2. **Агрегат и операции.** `gen aggregate todo.task` добавляет state, события, ошибки, Ar, Policy и репозиторий. `gen uc todo.task complete-task` создаёт пару «контракт в домене ↔ реализация в прикладном слое», `er` и `job` работают так же, а `dcs` / `dqs` создают доменные сервисы. В заготовках остаются `TODO` — по ним видно, что заполнить. Как именно, подскажет гайд вида ([индекс](docs/guides/index.md)) и тот же артефакт в учебном модуле.
3. **Проверка архитектуры.** Опиши приложение для `ArchChecker`: состав — `AppDef` из входа графа (`{ def, providers? }`, как [`example.graph.ts`](src/testing/example/example.graph.ts)), к нему — места слоёв (`ArchApp = { ...ExampleGraph, entry, project, layout, runners }`: проект, каталоги слоёв из `GenLayout.dirs()`, раннеры-процессы; как [`example.arch.ts`](src/testing/example/example.arch.ts)), — и вызови отчёт из `check` проекта:

   ```ts
   import { reportArchCheck } from 'dmg-core/arch';
   import { MyArch } from './my.arch';

   process.exit(reportArchCheck([MyArch], console.log));
   ```

   Каждое нарушение начинается с ID правила (`ARC-06: …`). Расшифровка ID — в [каталоге правил](docs/reference/rules.md); путь к нему отчёт печатает сам.
4. **Lint-правила.** Правила DOM, ERR, API и CODE — GritQL-плагины biome в [`biome-plugins/`](biome-plugins). Подключи их в `biome.json` проекта на свои каталоги, например домен не читает часы:

   ```json
   { "overrides": [{ "includes": ["src/platform/domain/**", "!**/*.test.ts"], "plugins": ["./node_modules/dmg-core/biome-plugins/dom-14-no-clock.grit"] }] }
   ```

   Какой плагин на какие пути — [карта линтера](docs/reference/rules.md#карта-линтера) в каталоге правил.
5. **Тесты.** Хелперы — в `dmg-core/testing`: `testAppContext`, `expectOk`, контракт идемпотентности реакций и другие ([testing.md](docs/reference/testing.md)).

## Подпути

| Импорт | Что |
|---|---|
| `dmg-core` | ядро и Def-классы (`XxxDef.define`), база `Def` для своего вида, текст отказа `ErrorText`, след `Trace` и его JSON `TraceJson` (D-102) — единственное, что импортирует домен |
| `dmg-core/app` | прикладной слой: UC/ER/Job по Def, модуль, UoW, фасады, репозитории; подписка внешнего слоя `EventSubscriber`, сверка `DeclaredSet` |
| `dmg-core/graph` | ядро графа, поставщик домена и граф приложения, нормализация Def, `DefIndex` ([граф приложения](docs/reference/graph.md)) |
| `dmg-core/arch` | `ArchChecker` (с правилами поставщиков графа), `Violation`, `reportArchCheck` |
| `dmg-core/gen` | `GenLayout`: раскладка проекта из `dmg-core.json` — один источник для `gen` и `ArchApp.layout` |
| `dmg-core/testing` | хелперы тестов и учебное приложение (`ExampleAppDef`, `ExampleGraph`, `ExampleArch`); образец расширения графа — исходники `src/testing/example/screen/` (читается как образец, стабильным входом не является) |
| `dmg-core/testing/example` | учебное приложение для тестов внешних пакетов: `ExampleApp`, `ExampleAppDef`, типы `ExampleAppEnv`, `ExampleAppPorts`, `ExampleUser`, контракты модулей todo и users (D-101), в том числе `TaskAr`, `TaskPolicy`, `TaskRules` и `OPEN_TASKS_LIMIT` (D-104); стабилен только этот вход, глубокие пути `dmg-core/testing/example/*` — нет |
| `dmg-core/cli` | `DmgCoreCli`: `init`, `sync`, `gen` как API; команды CLI `bunx dmg-core` — `init`, `sync`, `gen`, `oplog`, `graph` |

## Документация

- [Вход](docs/index.md): суть DMG, карта документов
- [Слои](docs/reference/layers.md), [моделирование домена](docs/reference/domain-modeling.md), [структура, имена и генератор](docs/reference/naming.md)
- [Манифесты](docs/reference/manifests.md), [граф приложения](docs/reference/graph.md), [ошибки и Result](docs/reference/errors-result.md), [Caller и Trace](docs/reference/caller.md), [транспорт](docs/reference/transport.md)
- [Каталог правил](docs/reference/rules.md), [решения](docs/decisions.md), [тестирование](docs/reference/testing.md), [стиль TypeScript](docs/reference/typescript.md)
- [Гайды по видам артефактов](docs/guides/index.md), [проект: профили и рост](docs/guides/project.md), [расширение графа и проверок](docs/guides/graph-extension.md)
- Для агентов: [`llms.txt`](llms.txt), скил [`dmg-architecture`](skills/dmg-architecture/SKILL.md), [роли](agents/README.md)

## Лицензия

MIT — [LICENSE](LICENSE).
