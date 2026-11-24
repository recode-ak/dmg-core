# Структура и именование

**Назначение:** файловая структура домена и прикладного слоя, сокращения, имена файлов и объектов, генератор заготовок. Корни каталогов задаёт секция `gen` `dmg-core.json`, `ArchApp.layout` проекта берёт их оттуда же (`GenLayout`, §5); структуру внутри них проверяет проверка файлов `ArchChecker`, создаёт — `dmg-core gen` (§5). Образец — учебный модуль `src/testing/example`.

---

## 1. Сокращения (закреплены в `dmg-core`)

| Сокр. | Полное | Пример класса | Суффикс файла |
|---|---|---|---|
| Ar | Aggregate Root | `TaskAr` | `.ar.ts` |
| Uc | UseCase | `CompleteTaskUc` | `.uc.ts` |
| Er | EventReaction | `ReleaseRemovedUserTasksEr` | `.er.ts` |
| Job | Job | `ArchiveDoneTasksJob` | `.job.ts` |
| Dcs | DomainCommandService | `TaskReleaseDcs` | `.dcs.ts` |
| Dqs | DomainQueryService | `TaskProgressDqs` | `.dqs.ts` |
| Def | манифест (экземпляр Def-класса, `XxxDef.define`) | `CompleteTaskUcDef` | — |
| Repo | Repository | `TaskRepo`, `TaskJsonRepo` | `.repo.ts` |
| RepoFake | фейк порта для тестов UC/ER/Job (`MemoryRepo`) | `TaskRepoFake` | `.repo.fake.ts` |
| Uow | Unit of Work | `Uow` | — |
| Vo | Value Object | `TaskAssignmentVo` | — |
| Entity | вложенная сущность агрегата: своя идентичность `uuid`, живёт только внутри Ar | `SubtaskEntity` | — |
| Fqn | полное имя (`todo.task.completed`) | — | — |
| be | backend | пакет `@acme/be-todo` | — |

`be` — только в имени пакета реализации модуля в monorepo: `@<scope>/be-<m>` (D-106); каталог — полным словом, `backend/<m>`. Своё имя пакета задаёт `gen.package` (§5).

В тексте — заглавными (DCS, DQS), в коде — как слово (Google TS style): `TaskReleaseDcs`, не `TaskReleaseDCS`.

## 2. Домен: `<domain>/<m>/`

```
<m>/
  contract.ts              вход для остального кода: ModuleDef, Def внешних операций, события, ошибки, VO контрактов (D-45); Ar/Policy/DQS по нужде (D-69)
  index.ts                 API домена для своего пакета реализации (включая contract)
  testing.ts               фикстуры владельца для тестов зависимых (`userSubject(...)` → `UserAr.restore`); только тестовому коду (D-70)
  <m>.module.ts            ModuleDef.define — паспорт, dependsOn
  <topic>.dcs.ts           DCS модуля (несколько агрегатов)
  <topic>.dqs.ts           DQS модуля
  <aggregate>/
    <aggregate>.state.ts   схема entity и VO (единственное место структуры состояния)
    <aggregate>.ar.ts      агрегат + его Def (статусы, переходы)
    <aggregate>.policy.ts
    <aggregate>.rules.ts   доменные правила без субъекта (`<A>Rules = RulesDef.define`, D-40)
    <aggregate>.events.ts  группа событий агрегата (FQN-префикс задаётся один раз)
    <aggregate>.errors.ts  группа ошибок агрегата
    uc/<name>.uc.ts        контракт UC
    er/<name>.er.ts        контракт ER (папка основного агрегата — того, что мутируется)
    job/<name>.job.ts      контракт Job (папка основного агрегата)
  state.ts                 реэкспорт схем state для своего пакета реализации (наружу модуля не выходит)
  shared/                  поля и VO модуля поверх F.*
<kernel>/                  поля и VO приложения, общие для модулей: kernel приложения (`gen.kernel`, D-106)
<domain>/<имя>.app.ts      AppDef приложения (D-93): `<Имя>AppDef`, полный состав модулей; путь — поле `gen.appDef`
```

Подпути экспорта пакета домена: `<domain>/<m>/contract` — для другого кода; `<domain>/<m>/testing` — для тестового кода других (TST-07); `<domain>/<m>` — для своего пакета реализации. Подпути state нет: схемы entity наружу не выходят, форма данных — из контракта (D-45). Вход модуля, который проверяет ARC-04, задаёт `ArchApp` (`entry: 'contract'`), вход фикстур — `testing` (по умолчанию `'testing'`).

## 3. Прикладной слой: `<backend>/<m>/` (зеркало домена)

```
index.ts                   вход пакета для корня сборки: фабрика модуля, `*Deps`, репозитории (D-52)
<m>.module.ts              реализация модуля: карта Def → класс, резолвер
<aggregate>/
  <aggregate>.repo.ts      порт репозитория
  <aggregate>.repo.fake.ts фейк порта для тестов UC/ER/Job
  uc/<name>.uc.ts          реализация UC  (пара к <domain>/<m>/…/uc/<name>.uc.ts)
  er/<name>.er.ts
  job/<name>.job.ts
infra/<aggregate>.json-repo.ts
```

Правило пары: контракт и реализация имеют **одинаковый путь** относительно каталога модуля (`<domain>/<m>/` и `<backend>/<m>/`); контракт — `XxxDef`, реализация — `Xxx`.

## 4. Имена

| Что | Правило | Пример |
|---|---|---|
| Файлы, папки | kebab-case + суффикс вида | `complete-task.uc.ts` |
| Тесты | рядом, `<file>.test.ts` | `task.ar.test.ts` |
| Экспортируемые типы | рядом, `<file>.types.ts`; в файле класса — только приватные | `aggregate.types.ts`, `task-release.types.ts` |
| Классы, типы | PascalCase + сокращение | `TaskAr`, `TaskReleaseDcs` |
| Def | `<Имя><Вид>Def` | `TaskArDef`, `CompleteTaskUcDef` |
| `AppDef` приложения | файл `<домен>/<имя>.app.ts`, константа `<Имя>AppDef`; имя — имя пакета проекта без scope | `school.app.ts`, `SchoolAppDef` |
| Группы | `<Агрегат>Events`, `<Агрегат>Errors`, `<Агрегат>Rules` | `TaskEvents.completed` |
| События (FQN) | `module.aggregate.event`, событие — прошедшее время | `todo.task.completed` |
| Коды ошибок | UPPER_SNAKE с префиксом сущности, уникальны в приложении | `TASK_ALREADY_DONE` |
| UC | глагол + объект, kebab в имени | `complete-task` |
| Методы Ar | операции — глагол (`complete`), вопросы — `is/has/can` | `isTerminal()` |
| Методы Policy | доменный вопрос «можно ли?» | `canManage`, не `hasOwnerId` |
| Поля | camelCase; `uuid`, `createdAt`/`updatedAt` — через `F.*` | — |
| Константы | UPPER_SNAKE, экспортируются (пороги Job и т.п.) | `OPEN_TASKS_LIMIT` |
| Приватное | TS `private` / `protected`; `#private` запрещён | см. [typescript.md](./typescript.md) |

Отсутствие значения — `undefined`, не `null`.

## 5. Генератор `dmg-core gen`

`dmg-core gen <вид> <модуль>[.<агрегат>] [<имя>] [--write]` создаёт файлы по §2–§4. Без `--write` — dry-run (печатает план). Существующие файлы не перезаписываются: коллизия — ошибка, и ничего не записано. Код выхода 1 — ошибка ввода или коллизия.

| Команда | Что создаёт |
|---|---|
| `gen module <m>` | домен: `<m>.module.ts`, `contract.ts` (только паспорт: остальное в контракт добавляет автор, D-45), `index.ts`, тест; прикладной слой: `<m>.module.ts` (карта Def → класс, `Deps`, фабрика), вход `index.ts` для корня сборки и тест; с `gen.package` — пакет модуля (`package.json`, `tsconfig.json`). Подключает модуль к приложению: фабрика в корне сборки, `<M>ModuleDef` в `modules` файла `AppDef` (`gen.appDef`), с `gen.package` — зависимость в `package.json` пакета корня сборки. Фасада нет: он пишется руками по потребителю (D-42). Имя `app` — отказ: каталог занят общим реализаций `backend/app` (D-106) |
| `gen aggregate <m>.<a>` | домен: state, events, errors, Ar, Policy и тесты; прикладной слой: `<a>.repo.ts`, фейк `<a>.repo.fake.ts`, `infra/<a>.json-repo.ts` и тест; в корне сборки — `<a>Repo: new <A>JsonRepo(join(env.dataDir, '<m>.<a>.json'))` в фабрике модуля |
| `gen uc\|er\|job <m>.<a> <имя>` | пара: контракт в домене и реализация в прикладном слое по тому же относительному пути (`<a>/<вид>/`), плюс тесты. UC `create`/`create-*` — рабочий UC создания, прочие — загрузка агрегата по id |
| `gen dcs\|dqs <m> <имя>` | сервис в домене с тестом |

Генератор правит существующие файлы только по маркерам: `// gen:exports` (`index.ts`), `// gen:defs:imports|aggregates|useCases|reactions|jobs` (паспорт и карта модуля), `// gen:deps` (`Deps` прикладного модуля); в корне сборки (`init` пишет их в каркас) — `// gen:imports` (конец блока импортов `app.ts` и файла `AppDef`), `// gen:modules` (конец списка модулей в них же), `// gen:repos:<m>` (внутри `create<M>Module({ ...deps, … })`); `dependencies` `package.json` пакета корня сборки правятся как JSON. Нет файла или маркера, конфликт имён импорта — команда печатает «Вставь вручную в <файл> перед <маркер>» с причиной и не падает. Повтор вставки не дублирует строку и импорт. Заготовки содержат `TODO` (названия, описания, схемы): их заполняет автор; тесты UC берут фейк порта `<a>.repo.fake.ts` (`gen uc` создаёт его, если агрегат сгенерирован без фейка), контрактный тест репозитория — настоящий JSON-репозиторий во временном каталоге. Импорты и переносы длинных строк — в форме biome: заготовки проходят `check` без правок. Подсказки печатаются после плана (например, MAN-06: «Событие created публикует UC создания»).

`--adopt` — перевод существующего модуля на Def: `gen module` допускает каталог модуля без `<m>.module.ts`, `gen aggregate` — каталог агрегата без `<a>.state.ts`. Существующие `index.ts`, `contract.ts`, `package.json` и `tsconfig.json` не перезаписываются (печатается «Пропущен» с шаблоном, правки по маркерам идут в `index.ts`); пропуск — по имени файла. Остальные коллизии — ошибка.

**Раскладка** — секция `gen` в `dmg-core.json` (корень проекта; без файла — значения по умолчанию). Шаблоны с `{m}`; пути — от корня проекта:

| Поле | Что | По умолчанию |
|---|---|---|
| `domain` | каталог модуля домена | `src/platform/domain/{m}` |
| `backend` | каталог реализации модуля | `src/backend/{m}` |
| `domainImport` | спецификатор импорта домена из реализации (например, `@acme/domain/{m}`) | не задан — относительный путь к каталогу модуля домена (его `index.ts`; нужен `moduleResolution: bundler`) |
| `assembly` | каталог сборки (`app.ts`), без `{m}` | `src/runners/assembly`, если `domain` и `backend` по умолчанию; иначе не задан — сборку генератор не правит, печатает подсказку |
| `kernel` | каталог kernel — общего для домена и слоёв над ним, без `{m}` | `src/platform/kernel`, если `domain` и `backend` по умолчанию; иначе не задан |
| `appDef` | файл `AppDef` (`<домен>/<имя>.app.ts`), без `{m}`: `gen module` вписывает в него Def модуля | не задан — имя приложения генератору неизвестно; `init` пишет путь; без поля `gen module` печатает подсказку |
| `package` | имя пакета workspaces реализации модуля (например, `@acme/be-{m}`): `gen module` создаёт пакет над каталогом `backend`; требует `domainImport` и `backend`, оканчивающийся на `/src` | не задан — пакета нет, реализация внутри пакета проекта |

```json
{ "gen": { "domain": "platform/domain/src/{m}", "backend": "backend/{m}/src", "kernel": "platform/kernel/src", "domainImport": "@acme/domain/{m}", "package": "@acme/be-{m}", "assembly": "runners/assembly/src", "appDef": "platform/domain/src/school.app.ts" } }
```

Ключи `gen.app` и `gen.compositionRoot` переименованы в `gen.backend` и `gen.assembly` (D-106): старый ключ — ошибка чтения с новым именем, без псевдонима.

**Гибки только корни каталогов.** Форма внутри модуля (§2–§3) фиксирована: пары «контракт ↔ реализация» по одинаковому относительному пути (MAN-10), 1:1 домена и прикладного слоя (ARC-06). Третьей раскладки внутри модуля нет.

Раскладка — один источник для генератора и `arch:check`: проект берёт каталоги слоёв `ArchApp.layout` из `GenLayout.dirs()` (`dmg-core/gen`), а не пишет пути вручную; раннеры-процессы — списком `runners`. Первая строка вывода `gen` — применяемая раскладка.

```ts
import { join } from 'node:path';
import { GenLayout } from 'dmg-core/gen';
import SchoolGraph from './school.graph'; // вход dmg-core graph: { def: SchoolAppDef }

const layout = await GenLayout.read(root); // секция gen dmg-core.json
export const SchoolArch: ArchApp = {
  ...SchoolGraph,
  entry: 'contract',
  project: root,
  layout: layout.dirs(), // kernel, domain/{m}, backend/{m}, assembly
  runners: [join(root, 'runners/bot/src')],
  graphEntry: join(root, 'scripts/school.graph.ts'), // файл входа графа (ARC-16)
};
```

Состав приложения и поставщики графа `ArchApp` берёт из входа графа (D-97): один список поставщиков для `dmg-core graph` и `arch:check`; путь к его файлу — `graphEntry` (D-108).

Каркас проекта (конфиги, `check`, корень сборки, раннер) создаёт `dmg-core init --profile single|monorepo`, секцию `gen` пишет он же. Без `gen.package` генератор пишет только исходники: пакет модуля и workspace — забота проекта.
