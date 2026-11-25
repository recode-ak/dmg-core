---
covers:
  - src/cli/scaffold/**
verified: 0237dac
---

# Проект — гайд

**Назначение:** как начать проект на DMG и как он растёт: каркас `dmg-core init --profile single|monorepo` (конфиги, `check`, корень сборки, раннер CLI), затем модули генератором — он же подключает их к сборке; руками — только смысл заготовок.

---

## 1. Когда применять

- **single** — один пакет, всё в `src/` по осям D-106: kernel `src/platform/kernel`, домен `src/platform/domain`, реализации `src/backend/<m>`, сборка `src/runners/assembly`, раннер `src/runners/cli`. Для старта, учебных и небольших проектов; раскладка как у учебного приложения пакета. Проверки единицы выноса в нём молчат — ARC-14, ARC-15 и ARC-16 по `package.json` единиц; вход графа проверяется и здесь: его замыкание не доходит до реализаций (ARC-16, D-111). Проект, который будет расти, — `monorepo`.
- **monorepo** — те же оси пакетами workspaces `@<scope>/*`: kernel `platform/kernel` (`@<scope>/kernel`), домен `platform/domain` (`@<scope>/domain`), пакет реализации на модуль `backend/<m>` (`@<scope>/be-<m>`), сборка `runners/assembly` (`@<scope>/assembly`), раннеры-процессы `runners/<r>`. Когда модулей несколько и границы должны держаться на уровне пакетов; `scope` — из имени проекта (`@acme/school` → `acme`). Пакет объявляет всё, что импортирует; между пакетами — имя и `exports` (ARC-14…16, D-108); пакет реализации модуля — единица выноса в сервис ([extract-module.md](./extract-module.md)).
- Профиль выбирается один раз: переход между ними — перенос каталогов и правка секции `gen` `dmg-core.json`, генератора для него нет.
- Уже есть проект — `dmg-core init` без профиля (только `dmg-core.json`, скилы и роли) и раскладка в секции `gen` ([naming.md](../reference/naming.md) §5).

## 2. Команда

```sh
mkdir school && cd school && echo '{ "name": "@acme/school" }' > package.json
bun add dmg-core                         # до публикации: bun add ./dmg-core-<версия>.tgz
bunx dmg-core init --profile monorepo   # или single; --dry-run — только план, --name — имя проекта
bun install && bun run check
```

Порядок важен: сначала `bun add dmg-core`, потом `init` — бинарь `dmg-core` берётся из установленного пакета. Имя проекта — `--name`, иначе `name` из `package.json`, иначе имя каталога. Имя пакета без scope становится именем приложения (`AppDef`, сегмент `id` графа), поэтому оно должно соответствовать `^[a-z][a-z0-9-]*$` (`acme.io`, `1school`, `@acme/_x` — отказ). Существующие файлы не перезаписываются (коллизия — ошибка, ничего не записано); существующий `package.json` дополняется и пишется последним, после проверки коллизий; добавлять нечего — файл не переписывается. Если `dmg-core` поставлен не из реестра (tarball, `file:`), `init` переписывает путь в зависимости корня относительно корня проекта (`../dmg-core-0.1.0.tgz`) — проект переносим вместе с tarball. В monorepo он же добавляет `overrides.dmg-core` с тем же путём — иначе `bun install` ищет `dmg-core` пакетов workspaces в реестре и падает 404. Старый абсолютный `overrides` на тот же файл заменяется; на другой пакет — ошибка с подсказкой, ничего не записано. Поставил `dmg-core` не из реестра уже после `init` — добавь `overrides` руками.

## 3. Что создаёт `init`

| Файл | single | monorepo |
|---|---|---|
| `package.json` | `version` `0.1.0` (есть в проекте — остаётся), скрипты `check`, `lint`, `format`, `arch:check`, `graph`; версии из пакета | то же + `workspaces` `platform/*`, `backend/*`, `runners/*`, домен в `devDependencies` корня |
| `tsconfig.json`, `biome.json` | строгий TS; `overrides` по [карте линтера](../reference/rules.md#карта-линтера); `data/` biome не проверяет | то же; у каждого пакета свой `tsconfig.json` поверх корневого |
| `dmg-core.json` | секция `gen` — все ключи осей: `domain`, `backend`, `kernel`, `assembly: src/runners/assembly`, `appDef` | все ключи осей: `domain`, `backend`, `kernel: platform/kernel/src`, `domainImport`, `package: @<scope>/be-{m}`, `assembly: runners/assembly/src`, `appDef` |
| `scripts/arch-check.ts` | `ArchApp` собирается из входа графа: `{ ...<Имя>Graph, entry, project, layout, runners, graphEntry }` — состав приложения (`AppDef`, поставщики с правилами и слоями) берётся из `scripts/<имя>.graph.ts`; `project` — корень проекта, каталоги слоёв — `GenLayout.dirs()` из `dmg-core.json`, раннеры-процессы — списком (раннер CLI), `graphEntry` — путь к тому же `scripts/<имя>.graph.ts` (ARC-16, D-108); маркеров генератора нет | то же; `AppDef` — из `@<scope>/domain` (через вход графа) |
| `scripts/<имя>.graph.ts` (D-96) | вход `dmg-core graph`: `export default { def: <Имя>AppDef } satisfies GraphApp`; `bun run graph` пишет `graph.json` — документ графа приложения (версия — из `version` в `package.json`); `graph.json` в `.gitignore`, не коммитится; поставщиков графа сверх домена добавляй в `providers` — их правила попадут и в `arch:check` ([graph-extension.md](./graph-extension.md)) | то же; `AppDef` — из `@<scope>/domain` |
| `AppDef` (D-93) | `src/platform/domain/<имя>.app.ts` — `<Имя>AppDef` (имя пакета без scope) с маркерами `gen:imports`, `gen:modules`, `TODO` в `label` и `description`; путь — `gen.appDef` | `platform/domain/src/<имя>.app.ts`, экспорт из `platform/domain/src/index.ts` (вход домена — только `AppDef`) |
| kernel и домен | `src/platform/kernel/app-user.ts` — тип пользователя (без `index.ts`, сборка импортирует файл); домен — `src/platform/domain` | `platform/kernel/` — пакет `@<scope>/kernel`, вход `src/index.ts` (`AppUser`); `platform/domain/` — пакет `@<scope>/domain` с `exports` `./*/contract`, `./*/testing`, `./*` |
| корень сборки | `src/runners/assembly/app.ts`, резолвер `Caller`, тест | `runners/assembly/` — пакет `@<scope>/assembly` (зависит от `@<scope>/domain` и `@<scope>/kernel`) |
| раннер | `src/runners/cli/`: окружение, CLI, `main.ts`, тесты | `runners/cli/` (зависит от `@<scope>/domain` и `@<scope>/assembly`) |
| `.gitignore`; агенты (`init` выполняет `dmg-core sync`) | `.gitignore` (`node_modules/`, `data/`, `graph.json`); скилы и роли (`.claude/`), ссылка на `llms.txt` в `AGENTS.md` | то же |

Раннер сразу работает (`<раннер>` — `src/runners/cli` | `runners/cli/src`):

```sh
APP_DATA_DIR=data bun <раннер>/main.ts whoami [--user <uuid>]
APP_DATA_DIR=data bun <раннер>/main.ts call <module>.<operation> [--input '<json>'] [--user <uuid>]
```

`call` вызывает любой UC подключённого модуля по имени (`todo.create` — имена Def модуля и UC, как в логе операций; `gen uc todo.task complete-task` → `call todo.completeTask`, агрегата в адресе нет) через `app.api.dispatchByName` и печатает `Result` JSON целиком (с `label`/`description` ошибки — это вывод для человека, не wire-формат [transport.md](../reference/transport.md)). Коды выхода: 0 — `Ok`, 1 — ошибка ввода (argv, JSON, uuid), 2 — `Err` операции (в том числе `OPERATION_NOT_FOUND`, `INPUT_VALIDATION`, `UNAUTHORIZED`), 3 — окружение. Как устроены приложение и раннер — [app.md](./app.md).

**Резолвер каркаса — заглушка разработки.** Пока нет модуля пользователей, `--user <uuid>` даёт `UserCaller` без ролей, без `--user` — гость. Uuid принимается на веру только с канала `cli` (проверка в коде): с другого канала — исключение, удалённый вход (HTTP, бот) без модуля пользователей — дефект конфигурации. Uuid, придуманные в CLI, попадут в данные и не совпадут с реальными пользователями — это отступление от D-50 (`UserCaller` выдаёт модуль пользователей) только для каркаса. Резолвер возвращает `Result<PersonCaller, DelegationDenied>`: заявка на делегирование (`--on-behalf <uuid> --delegation <id>`, D-89) заглушкой отклоняется — `DELEGATION_DENIED { reason: 'disabled' }`, код 2; порт `DelegationStore` приложение подключает вместе с модулем пользователей.

`check` проекта: `dmg-core sync --check` → `biome check` → `tsc --noEmit` → `arch:check` → `bun test`. Незаполненные `TODO` в `label`/`description` Def `arch:check` печатает предупреждением (MAN-01) и не роняет — заготовки зелёные; `bun run arch:check --strict` считает их нарушениями (код 1) — для CI и перед выпуском.

**Учёт долга (ARC-12, D-84).** Проект с реестром долга подключает `DebtChecker` из `dmg-core/arch` в `scripts/arch-check.ts` (каркас его не пишет): строки отчёта печатаются вместе с нарушениями `arch:check` и влияют на код выхода.

```ts
const LAYOUT: DebtLayout = {
  code: ['src/**/*.ts', 'scripts/**/*.ts'],
  exclude: ['scripts/**/*.test.ts'],
  registries: { code: 'debt/code.md', tests: 'debt/tests.md' },
};
const debt = new DebtChecker({
  idPrefix: 'C-DEBT',
  tempMarkers: { skip: ['scripts/**'] },
  registryPaths: LAYOUT.registries,
}).report(await DebtChecker.read('.', LAYOUT));
```

Отступление от правила слоя поставщика графа (доступ с `debt`, D-111) — запись того же реестра долга кода с полем «Правило» (ID доступа) и Местом (glob'ы файлов-импортёров). Реестр передаётся в `ArchApp`: `debt: { root: <корень репо>, code: 'debt/code.md', idPrefix: 'C-DEBT' }` — корень путей Места, путь реестра от него, префикс. `arch:check` снимает по записи нарушение с этим ID в файле Места; glob, который ничего не снял, ID без разрешения и «Правило» без ID — ARC-12. Остальные поля записи сверяет `DebtChecker`, как прежде.

Форматы реестров и что проверяется — ARC-12 в [rules.md](../reference/rules.md), D-84 и D-111.

## 4. Как растёт проект

```sh
bunx dmg-core gen module todo --write          # домен, реализация (monorepo — пакет backend/todo), подключение
bunx dmg-core gen aggregate todo.task --write  # агрегат и JSON-репозиторий в фабрике модуля
bunx dmg-core gen uc todo.task create --write  # рабочий UC создания, публикует created
bunx dmg-core gen uc todo.task complete --write
bun install && bun run check                   # bun install — после gen module в monorepo
APP_DATA_DIR=data bun <раннер>/main.ts call todo.create --user "$(bun -e 'console.log(crypto.randomUUID())')"
```

1. **Подключение — генератор** ([naming.md](../reference/naming.md) §5, маркеры `// gen:imports`, `// gen:modules`, `// gen:repos:<m>`):
   - `gen module` — фабрика в список модулей корня сборки (`{ def: <M>ModuleDef, create: (deps) => create<M>Module({ ...deps }) }`; фабрика — из входа пакета реализации, Def — из контракта домена), `<M>ModuleDef` — в `modules` файла `AppDef` (`gen.appDef`; импорт Def — относительный, файл лежит в пакете домена), в monorepo — `"@<scope>/be-<m>": "workspace:*"` в `runners/assembly/package.json` (затем `bun install`);
   - `gen aggregate` — репозиторий в фабрику: `<a>Repo: new <A>JsonRepo(join(env.dataDir, '<m>.<a>.json'))` (имя файла уникально в приложении).
   - Нет маркера (своя раскладка, правленый `app.ts`) или конфликт имён импортов (агрегаты с одним именем в двух модулях) — генератор печатает «Вставь вручную в <файл> перед <маркер>» с причиной и не падает. Без `gen.assembly` при своей раскладке корень сборки не правится, без `gen.appDef` не правится `AppDef` — подсказка называет поле.
2. **UC.** `gen uc <m>.<a> create` (или `create-*`) — рабочий: `<A>Ar.create`, `uow.register`, `emits: [created]`, выход `<a>Id`; остаётся перенести поля входа. Остальные — `load` агрегата по `<a>Id` с `NOT_FOUND`, `execute` с `TODO` для операции домена, `emits: []` ([use-case.md](./use-case.md) §2). Событие `created` должен кто-то публиковать (MAN-06): генератор напоминает, пока UC создания нет.
3. **Вызов.** Любой UC — `call` раннера; отдельный e2e-тест `call` проекту не нужен: раннер покрыт тестами каркаса, сценарии — тестами Ar и UC. Своя команда в `runner-cli.ts` нужна только для удобного интерфейса (образец — [app.md](./app.md) §3). Видимость для транспорта задают `callers` и Policy, а не `contract.ts` (D-54): контракт — граница импортов между модулями.
4. **Модуль пользователей** — резолвер `Caller` вместо заглушки (TODO в `app-caller-resolver.ts`, образец — [app.md](./app.md) §3); роли приложения — сузить `role` в типе пользователя (TODO в `app-user.ts` kernel приложения, D-53, D-106). Эти `TODO` в комментариях `arch:check --strict` не ловит: он проверяет только тексты Def.
5. После ручных правок — `bun run format` (порядок импортов biome), затем `bun run check`. Код генератора проходит `check` без правок.

## 5. Кто что правит руками

- **Каркас** пишется один раз: дальше `app.ts`, файл `AppDef`, `arch-check.ts`, вход графа, раннер и конфиги — код проекта, `init` их не обновляет. Маркеры `// gen:…` (в `app.ts`, файле `AppDef`, `index.ts`) не удаляй — по ним генератор подключает модули.
- **Генератор** создаёт заготовки и правит существующие файлы только по маркерам: паспорт и карту модуля, `index.ts`, `Deps`, корень сборки, `modules` файла `AppDef`, `dependencies` пакета корня сборки.
- **Автор** заполняет `TODO` заготовок (названия, схемы, поля state, операции Ar), контракт модуля для других модулей (D-45), `dependsOn`, `callers` и `policy` UC.
- **`dmg-core sync`** обновляет скилы и роли агентов после обновления пакета; `biome.json` и `tsconfig.json` после обновления пакета сверяй с картой линтера сам.

## 6. Чеклист правил

- ARC-07, ARC-08 — сборка берёт фабрику только из входа пакета реализации; раннер-процесс — только сборку, `kernel` и контракты.
- ARC-06 — пакет реализации модуля не импортирует соседей, сборку и раннеры; один пакет на модуль домена.
- ARC-09 — окружение читает только `main.ts` раннера.
- MAN-01 — `label`/`description` Def заполнены (включая метки статусов и Policy): `arch:check` без предупреждения «незаполненных TODO», `arch:check --strict` зелёный.
- MAN-06 — каждое событие агрегата публикует какой-то UC/ER/Job (`arch:check`: «событие … никто не публикует»): объявил событие — сгенерируй операцию, которая его эмитит, или убери событие.
- TST-06 — `check` проекта зелёный после каждого шага.

## 7. Типичные ловушки

- Генератор напечатал «Вставь вручную» и это пропустили — модуль не подключён: UC отвечает `OPERATION_NOT_FOUND`, `arch:check` модуль не проверяет.
- monorepo: после `gen module` не выполнен `bun install` — `tsc` не находит `@<scope>/be-<m>`, `arch:check` красный по ARC-15 «… мимо exports (или пакет не установлен — bun install)» на `@<scope>/be-<m>`.
- Модуль назван `app` — `gen module` отказывает («Имя модуля «app» зарезервировано»): имя занято общим реализаций `backend/app` (D-106).
- `call` без `--user` — гость: UC с `callers: ['user']` отвечает `UNAUTHORIZED` (код 2). Нужен `--user <uuid>` или `'guest'` в `callers`.
- UC не-create сгенерирован раньше UC создания — `arch:check` красный по MAN-06 (`created` никто не публикует): `gen uc <m>.<a> create`.
