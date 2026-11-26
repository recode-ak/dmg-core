# DMG — Domain Manifest Graph

**Назначение:** вход в документацию фреймворка `dmg-core`: суть подхода и карта документов. Образец во всех документах — учебный модуль пакета [src/testing/example](../src/testing/example/example.arch.ts) (модули `todo` и `users`); образец расширения графа и проверок — [example/screen](../src/testing/example/screen/screen.graph.ts).

---

## Суть

Каждая доменная сущность описывается **один раз** манифестом (`*Def`). Из манифестов выводятся контракты для потребителей:

| Потребитель | Что получает |
|---|---|
| **Программист (DX)** | типы, базовые классы без boilerplate, `Result` с исчерпывающими ошибками |
| **Транспорт** (фронт↔бэк, сервис↔сервис) | автороутинг, автовалидация, контракт модуля по запросу |
| **PO / аналитик** | генерируемая доменная документация: модули, агрегаты, статусы, каскады, ошибки |
| **LLM (MCP)** | UC как tools, доменный граф как resources |
| **Контрактные тесты** | проверка, что код соответствует декларациям (`ArchChecker`) |

Приложение на DMG делится на четыре оси — фреймворк, платформа приложения (`kernel` и домен), реализации, раннеры ([layers.md](./concepts/layers.md), D-106). Домен чистый и синхронный; модули связаны только по `dependsOn`, единица выноса в отдельный сервис — пакет workspaces, основной случай — пакет реализации модуля (D-28, D-108).

## Начни отсюда

| Задача | Читай |
|---|---|
| Начать проект | [guides/project.md](./guides/project.md) → [guides/app.md](./guides/app.md) |
| Понять устройство | [concepts/](./concepts/index.md): [домен](./concepts/domain.md) → [слои](./concepts/layers.md) → [путь вызова UC](./concepts/uc-path.md) |
| Создать файл / объект | [naming.md](./reference/naming.md) → [rules.md](./reference/rules.md) |
| Написать артефакт по образцу | [guides/](./guides/index.md) |
| Вынести модуль в сервис или на другой язык | [guides/extract-module.md](./guides/extract-module.md) → [сценарии роста](./concepts/layers.md#сценарии-роста) |
| Подключить делегирование | [guides/delegation.md](./guides/delegation.md) |
| Расширить граф и проверки (пакет-поставщик) | [guides/graph-extension.md](./guides/graph-extension.md) → [reference/graph.md](./reference/graph.md) |
| Расширить `gen` и `sync` (виды заготовок, скилы и роли пакета-поставщика) | [guides/provider-extension.md](./guides/provider-extension.md) |
| Настроить проект: `providers`, `layers`, `gen`, `skills`, `roles` в `.dmg/config.json` | [guides/provider-extension.md](./guides/provider-extension.md) §2, [reference/naming.md](./reference/naming.md) §5, [agents/README.md](../agents/README.md) |
| Объявить контракт | [manifests.md](./reference/manifests.md), [errors-result.md](./reference/errors-result.md) |
| Работать агентом | скил `dmg-architecture` ([SKILL.md](../skills/dmg-architecture/SKILL.md)), роли [agents/](../agents/README.md), процесс [process.md](./process.md) |

## Документы

**Как устроено и почему**
- [concepts/](./concepts/index.md) — потоки, жизненный цикл, схемы
- [decisions.md](./decisions.md) — реестр решений фреймворка D-NN
- [process.md](./process.md) — процесс разработки: постановка, роли, срез, проверки

**Как сделать**
- [guides/](./guides/index.md) — гайды по видам артефактов на учебном модуле

**Что обязательно** (`reference/`)
- [rules.md](./reference/rules.md) — **каталог правил с ID** и способом проверки; учёт долга — ARC-12 (`DebtChecker`)
- [layers.md](./reference/layers.md) — оси, импорты, доменный API, доступ к entity, прикладной слой, адаптеры
- [domain-modeling.md](./reference/domain-modeling.md) — модуль-владелец, антипаттерны, границы модулей, агрегат
- [naming.md](./reference/naming.md) — сокращения, файловая структура, имена, генератор
- [manifests.md](./reference/manifests.md) — Def-классы (`XxxDef.define`), описания, схемы, граф, проверки
- [graph.md](./reference/graph.md) — граф приложения: документ `.dmg/graph.json`, ядро, поставщик домена (дерево id, виды, рёбра, внешние id), команда dmg-core graph
- [errors-result.md](./reference/errors-result.md) — `Result`, модель ошибки, базовые ошибки ядра, гарантии исполнения UC
- [caller.md](./reference/caller.md) — кто вызывает: `guest`, `user`, `delegate`, `system`; след `Trace`
- [transport.md](./reference/transport.md) — HTTP (JSON-команда), отсев повторов, MCP, in-proc
- [oplog.md](./reference/oplog.md) — лог операций: запись, патч полей, маскирование `F.sensitive`, срок хранения, чтение (`dmg-core oplog`)
- [testing.md](./reference/testing.md) — тестирование; хелперы `dmg-core/testing` (фейк `MemoryRepo`, `testTrace`, `testUuid`, `TempDir`, мини-монорепо `Monorepo`)
- [typescript.md](./reference/typescript.md) — стиль TypeScript
- [docs-format.md](./reference/docs-format.md) — создаёшь, правишь или переносишь документ, запись реестра, роль или скил

## Как устроена документация

Решение — D-59 ([decisions.md](./decisions.md)).

| Тип | Отвечает на вопрос | Содержит | Не содержит |
|---|---|---|---|
| `concepts/` | как устроено и почему | потоки, жизненный цикл, схемы (mermaid); `covers:` во front-matter | перечень полей и правил |
| `guides/` | как сделать артефакт | шаги на учебном модуле, ссылки на правила по ID; `covers:` | обоснование решений |
| `reference/` | что обязательно | правила с ID, имена, стиль TypeScript, коды ошибок; каждый факт — один раз | объяснение устройства |
| `decisions.md` | почему так, что отвергнуто | контракт или компромисс, причина (`D-NN`) | инструкции |
| JSDoc в `src/` | что гарантирует юнит | контракт, до 6 строк; длиннее — `@see` на документ или тест (CODE-04) | пересказ сигнатуры, сценарии сбоев прозой |

**Ссылки — в одну сторону:** concepts → guides, reference, decisions; guides → правила по ID и concepts; reference → только `D-NN`. Код ссылается на документы через `@see`; документ на код — только на образцы и в `covers:`. Ссылки проверяет тест в `check`.

**Входы:** этот файл — для человека; [llms.txt](../llms.txt) — для агента: reference и guides в основных разделах, [concepts/](./concepts/index.md) — в `Optional`, по требованию.

**Кто и когда актуализирует.** Затронутый документ обновляет автор среза в том же срезе, до гейта; `dmg-reviewer` проверяет, что документ обновлён или в отчёте сказано «не затронуто, потому что…». Какой документ затронут — подсказывают `covers:` и `docs:impact <пути>`; документ, чей исходник закоммичен позже него (считаются коммиты, менявшие код; комментарии и тесты — нет, в том числе комментарии в шаблонах каркаса и генератора: гайды их текст не цитируют), `docs:covers` показывает предупреждением в `check` и блокирует в гейте релиза (`--strict`, `RELEASING.md` репо пакета). Правка кода документ не затронула — после сверки во front-matter ставится `verified: <sha>` (коммит, на котором документ сверен с кодом), причина — в коммите или отчёте `dmg-reviewer`; `docs:covers` считает документ свежим с позднего из его правки и `verified`, неизвестный коммит — ошибка `check`. `verified` без сверки — подлог: предупреждение замолкает, а расхождение остаётся. Отдельного владельца документов нет: он не знает контекста изменения. Расхождения документов с кодом ищет аудит после фазы, менявшей документы, и перед релизом.

**Что куда писать при изменении:**

| Изменилось | Куда |
|---|---|
| правило | `reference/` — новый или изменённый ID |
| способ сделать артефакт | `guides/` |
| поток или жизненный цикл | `concepts/` |
| контракт или компромисс | `decisions.md` — новый `D-NN` или уточнение |
| формат графа (документ, виды и id домена, команда graph) | `reference/graph.md` |
