---
covers:
  - src/arch/file-checker.ts
  - src/arch/layer-checker.ts
  - src/gen/naming.ts
  - src/gen/kinds/**
---

# Структура и именование

**Назначение:** файловая структура домена и прикладного слоя, сокращения, имена файлов и объектов. Корни каталогов задаёт секция `gen` `.dmg/config.json` (`GenLayout`), структуру внутри них проверяет проверка файлов `ArchChecker`, создаёт — `dmg-core gen` ([gen.md](./gen.md)). Образец — учебный модуль `src/testing/example`.

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

`be` — только в имени пакета реализации модуля в monorepo: `@<scope>/be-<m>` (D-106); каталог — полным словом, `backend/<m>`. Своё имя пакета задаёт `gen.package` ([gen.md](./gen.md)).

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
| Грань теста | `<file>.<грань>.test.ts` — второй тест того же файла: режим, сторона, сценарий; грань — kebab-слово без точки | `graph.lift.test.ts`, `error-def.define.test.ts` |
| Тест темы | `<тема>-<что>.test.ts` рядом с головой темы `<тема>.ts`; сквозной тест без своего файла — по теме каталога | `main-graph.test.ts` (голова `main.ts`), `gen/e2e.test.ts` |
| Помощники тестов | `<тема>.fixture.ts` рядом с тестами, только тестовому коду пакета (TST-07); фикстуры для зависимых — `testing.ts` модуля (§2) | `arch.fixture.ts` |
| Экспортируемые типы | рядом, `<file>.types.ts`; в файле класса — только приватные | `aggregate.types.ts`, `task-release.types.ts` |
| Экспортируемые константы | рядом, `<file>.const.ts` — пара `<file>.types.ts` | `ui-file-names.const.ts` (`dmg-ui`) |
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

## 5. Генератор

Заготовки создаёт `dmg-core gen`, раскладку корней задаёт секция `gen` `.dmg/config.json` — [gen.md](./gen.md).
