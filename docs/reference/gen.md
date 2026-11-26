---
covers:
  - src/gen/project-config.ts
  - src/gen/main.ts
  - src/gen/cli.ts
  - src/gen/gen-kinds.ts
  - src/gen/gen-flags.ts
  - src/gen/layout.ts
  - src/cli/dmg-core-cli.ts
  - src/cli/cli-config.ts
verified: 9665ad5
---

# Генератор `dmg-core gen`

**Назначение:** команда `dmg-core gen` — что она создаёт и правит, секция `gen` `.dmg/config.json` (раскладка `GenLayout`), слои и виды поставщиков. Структура файлов и имена, по которым она работает, — [naming.md](./naming.md) §2–§4.

---

`dmg-core gen <вид> <модуль>[.<агрегат>] [<имя>] [--write]` создаёт файлы по [naming.md](./naming.md) §2–§4. Без `--write` — dry-run (печатает план). Существующие файлы не перезаписываются: коллизия — ошибка, и ничего не записано. Код выхода 1 — ошибка ввода или коллизия. Виды из таблицы ниже — свои виды `dmg-core`; пакеты-поставщики из `providers` добавляют свои (см. «Виды поставщиков»).

| Команда | Что создаёт |
|---|---|
| `gen module <m>` | домен: `<m>.module.ts`, `contract.ts` (только паспорт: остальное в контракт добавляет автор, D-45), `index.ts`, тест; прикладной слой: `<m>.module.ts` (карта Def → класс, `Deps`, фабрика), вход `index.ts` для корня сборки и тест; с `gen.package` — пакет модуля (`package.json`, `tsconfig.json`). Подключает модуль к приложению: фабрика в корне сборки, `<M>ModuleDef` в `modules` файла `AppDef` (`gen.appDef`), с `gen.package` — зависимость в `package.json` пакета корня сборки. Фасада нет: он пишется руками по потребителю (D-42). Имя `app` — отказ: каталог занят общим реализаций `backend/app` (D-106) |
| `gen aggregate <m>.<a>` | домен: state, events, errors, Ar, Policy и тесты; прикладной слой: `<a>.repo.ts`, фейк `<a>.repo.fake.ts`, `infra/<a>.json-repo.ts` и тест; в корне сборки — `<a>Repo: new <A>JsonRepo(join(env.dataDir, '<m>.<a>.json'))` в фабрике модуля |
| `gen uc\|er\|job <m>.<a> <имя>` | пара: контракт в домене и реализация в прикладном слое по тому же относительному пути (`<a>/<вид>/`), плюс тесты. UC `create`/`create-*` — рабочий UC создания, прочие — загрузка агрегата по id |
| `gen dcs\|dqs <m> <имя>` | сервис в домене с тестом |

Генератор правит существующие файлы только по маркерам: `// gen:exports` (`index.ts`), `// gen:defs:imports|aggregates|useCases|reactions|jobs` (паспорт и карта модуля), `// gen:deps` (`Deps` пакета реализации); в корне сборки (`init` пишет их в каркас) — `// gen:imports` (конец блока импортов `app.ts` и файла `AppDef`), `// gen:modules` (конец списка модулей в них же), `// gen:repos:<m>` (внутри `create<M>Module({ ...deps, … })`); `dependencies` `package.json` пакета корня сборки правятся как JSON. Нет файла или маркера, конфликт имён импорта — команда печатает «Вставь вручную в <файл> перед <маркер>» с причиной и не падает. Повтор вставки не дублирует строку и импорт. Заготовки содержат `TODO` (названия, описания, схемы): их заполняет автор; тесты UC берут фейк порта `<a>.repo.fake.ts` (`gen uc` создаёт его, если агрегат сгенерирован без фейка), контрактный тест репозитория — настоящий JSON-репозиторий во временном каталоге. Импорты и переносы длинных строк — в форме biome: заготовки проходят `check` без правок. Подсказки печатаются после плана (например, MAN-06: «Событие created публикует UC создания»).

`--adopt` — перевод существующего модуля на Def: `gen module` допускает каталог модуля без `<m>.module.ts`, `gen aggregate` — каталог агрегата без `<a>.state.ts`. Существующие `index.ts`, `contract.ts`, `package.json` и `tsconfig.json` не перезаписываются (печатается «Пропущен» с шаблоном, правки по маркерам идут в `index.ts`); пропуск — по имени файла. Остальные коллизии — ошибка.

**Раскладка** — секция `gen` в `.dmg/config.json` (корень проекта; без файла — значения по умолчанию). Шаблоны с `{m}`; пути — от корня проекта:

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

**Гибки только корни каталогов.** Форма внутри модуля ([naming.md](./naming.md) §2–§3) фиксирована: пары «контракт ↔ реализация» по одинаковому относительному пути (MAN-10), 1:1 домена и прикладного слоя (ARC-06). Третьей раскладки внутри модуля нет.

Раскладка — один источник для генератора и `arch:check`: проект берёт каталоги слоёв `ArchApp.layout` из `GenLayout.dirs()` (`dmg-core/gen`), а не пишет пути вручную; раннеры-процессы — списком `runners`. Первая строка вывода `gen` — применяемая раскладка.

**Слои поставщиков** — секция `layers` того же файла: `{ "<слой>": { "dir": "<шаблон с {m}>/src", "package": "@acme/{m}-x" } }`. `package` необязателен: только при `dir` на `/src`, `{m}` в нём — парой с `{m}` в `dir`; неизвестное поле секции и конфига — отказ. Проект передаёт их проверяющему слоёв: `ArchApp.layers` ← `GenLayout.layerDirs()`; виды поставщиков берут `layout.layerDir(слой, модуль)` и `layout.layerPackage(слой, модуль)`. Читалка конфига — `ProjectConfig` (`dmg-core/gen`): секции `providers`, `layers`, `gen`, `skills`, `roles` (`roles.refs` — `agents/README.md`), `instructions`, `docs` (дерево документации, [docs-format.md](./docs-format.md) § 7); прежний `dmg-core.json` — отказ с подсказкой переноса.

**Виды поставщиков.** Пакет из `providers` может экспортировать из входа `<пакет>/dmg-core` виды `gen` (`GenProvider`; гайд — `guides/provider-extension.md`). Вызов — `dmg-core gen <вид> <аргументы> [--write] [--dry-run] [--adopt]`: флаги разбирает ядро, аргументы после имени вида — сам вид. План вида идёт через тот же `applyPlan`, что и у своих видов (dry-run, `--write`, `--adopt`); первая строка вывода — `Вид «<имя>» — <пакет>, слои: …` (вместо раскладки `gen`). Подсказка при неизвестном виде или пустой команде дополняется блоком:

```
Виды поставщиков (dmg-core gen <вид> <аргументы> [--write] [--dry-run] [--adopt]):
  example-unit <модуль> — example-provider
```

Имя вида — у одного владельца: совпадение с видом `dmg-core` или другого поставщика — отказ с обоими именами. Сломанный вход ломает `gen`, но не `sync` и `sync --check`.

```ts
import { join } from 'node:path';
import { GenLayout } from 'dmg-core/gen';
import SchoolGraph from './school.graph'; // вход dmg-core graph: { def: SchoolAppDef }

const layout = await GenLayout.read(root); // секция gen .dmg/config.json
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

Каркас проекта (конфиги, `check`, корень сборки, раннер) создаёт `dmg-core init --profile single|monorepo`, секцию `gen` пишет он же (`.dmg/config.json` — в git, `.dmg/graph.json` — в `.gitignore`). Без `gen.package` генератор пишет только исходники: пакет модуля и workspace — забота проекта.
