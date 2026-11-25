# Роли агентов DMG

Роли для агентных сред (Claude Code, pi), которые пишут модули на `dmg-core`. Источник — этот каталог пакета; в проект их доставляет `dmg-core init` / `sync`, проект может дописать свой общий блок (процесс, гейт, запреты). Роли и скилы других пакетов (поставщиков) доставляет тот же `sync` — секция `providers` конфига; пакет кладёт роли в свой `agents/roles/` ([provider-extension.md](../docs/guides/provider-extension.md)).

| Роль | Что делает |
|---|---|
| [dmg-tech-lead](./roles/dmg-tech-lead.md) | черновик плана по spec и коду; черновик брифа среза в начале фазы; только читает |
| [dmg-test-designer](./roles/dmg-test-designer.md) | тесты среза до реализации: характеризация текущего поведения и red по Def |
| [dmg-domain-author](./roles/dmg-domain-author.md) | домен среза: state, Ar, Policy, события, ошибки, DCS/DQS, все Def и их тесты |
| [dmg-api-author](./roles/dmg-api-author.md) | прикладной слой среза: UC/ER/Job по готовым Def, репозитории, сборка модуля и тесты |
| [dmg-data-keeper](./roles/dmg-data-keeper.md) | что станет с уже лежащими записями: чтение старого формата, путь миграции, резервная копия; по триггеру (state, репозитории, снимки) |
| [dmg-reviewer](./roles/dmg-reviewer.md) | ревью diff среза по правилам с проверкой `review`; код не правит |

Порядок среза: `dmg-tech-lead` (бриф) → `dmg-test-designer` → `dmg-domain-author` → `dmg-api-author` → `check` проекта → `dmg-data-keeper` (по триггеру) → `dmg-reviewer`. Процесс целиком — [docs/process.md](../docs/process.md), решение — D-62. Общий блок всех ролей — [common.md](./common.md); привязку к проекту (где лежат spec, план и брифы, эталон, правила данных) проект дописывает своим общим блоком.

## Формат `roles/<role>.md`

```markdown
---
name: dmg-reviewer            # совпадает с именем файла
description: Что делает роль и когда её вызывать
tools: [read, grep, find, bash]
model:                    # необязательно; без него — модель среды
  claude: sonnet
  pi: claude-sonnet-4-5
---

Промпт роли.
```

- `tools` — обязателен, только нейтральные имена: `read`, `edit`, `write`, `bash`, `grep`, `find` (среда переводит их в свои: `Read`/`read`, `Glob`/`find` и т. д.); минимум инструментов на роль.
- `model` — допустимые ключи `claude` и `pi`; значение передаётся в среду как есть.
- Копия роли для среды = тело роли + `common.md` пакета (+ общий блок проекта, если его дописывает сборщик проекта).

## Доставка в проект: `dmg-core init` / `sync`

```bash
bunx dmg-core init          # создать .dmg/config.json (если нет) и выполнить sync
bunx dmg-core sync          # обновить копии после обновления пакета
bunx dmg-core sync --check  # для check проекта: код 1, если копии устарели или правлены
```

Что и куда класть, решает проект в `.dmg/config.json` (все поля необязательны, `init` пишет значения по умолчанию; прежний `dmg-core.json` в корне — отказ с подсказкой переноса):

```json
{
  "providers": ["example-provider"],
  "skills": { "names": ["dmg-architecture"], "dirs": [".claude/skills"] },
  "roles": {
    "names": ["dmg-domain-author", "dmg-api-author", "dmg-reviewer"],
    "targets": [{ "dir": ".claude/agents", "format": "claude" }]
  },
  "instructions": "AGENTS.md"
}
```

- `providers` — пакеты-поставщики скилов, ролей и видов `gen` сверх `dmg-core` (он подключён всегда); корень пакета ищется через вход `<пакет>/dmg-core`; нет пакета — отказ. Ещё есть секции `layers` (места слоёв поставщиков) и `gen` (раскладка модулей) — [naming.md](../docs/reference/naming.md) §5.
- `skills.names` / `roles.names` — что взять из поставки (`dmg-core` и поставщики; по умолчанию всё, имя — у одного владельца, конфликт — отказ с обоими). Явный список, записанный `init`, скрывает скилы и роли поставщика, добавленного позже, — без предупреждения: допиши имена; `skills.dirs` — каталоги скилов сред.
- `roles.targets` — цели: `format: "claude" | "pi"` — готовые роли среды с `common.md` пакета в конце; `format: "neutral"` — роли в формате выше для сборщика ролей проекта, `common` — путь, куда положить `common.md` пакета (сборщик дописывает его ко всем ролям, включая проектные).
- `instructions` — файл инструкций агентов, куда вставляется блок `<!-- dmg-core:begin/end -->` со ссылкой на `node_modules/dmg-core/llms.txt`; `null` — не вставлять.
- Каждая копия несёт метку `<!-- <пакет>@<версия>: сгенерировано … -->`: пакет — владелец копии (`dmg-core` или поставщик), версия — из его `package.json`. `sync` трогает только файлы с меткой: свои копии без источника (в том числе пакета, убранного из `providers`) удаляет, файл проекта на месте копии не перезаписывает (ошибка). Общий блок `common.md` — только у `dmg-core`: у поставщика файл `agents/common.md` — ошибка поставки; к ролям поставщика `sync` дописывает общий блок `dmg-core`. Программный API — `dmg-core/cli` (`Marker.strip` снимает метку любого пакета в сборщике проекта; `PackageSet`, `ProviderPackage`).
