# Гайды по видам артефактов

**Назначение:** как написать артефакт DMG по образцу — учебному модулю пакета ([src/testing/example](../../src/testing/example/example.arch.ts): `todo` — задачи, `users` — пользователи). Один файл на вид, формат — [_template.md](./_template.md). Ссылки и ID правил во всей документации пакета проверяет `scripts/docs-check.test.ts` (в `check` пакета).

Раскладка примера: kernel — `example/platform/kernel/`, домен — `example/platform/domain/<m>/`, реализации — `example/backend/<m>/`, сборка — `example/runners/assembly/example-app.ts`, раннер — `example/runners/cli/`, `AppDef` — `example/platform/domain/example.app.ts`, вход графа (`dmg-core graph`) — `example.graph.ts`, `ArchApp` — `example.arch.ts`; расширение графа и проверок — `example/screen/`. В проекте корни задаёт секция `gen` `dmg-core.json` ([naming.md](../reference/naming.md) §5). Заготовки создаёт генератор `dmg-core gen <вид> …` (раздел «Команда» каждого гайда).

---

| Вид | Гайд | Образец |
|---|---|---|
| state | [state.md](./state.md) | `platform/domain/todo/task/task.state.ts` |
| aggregate | [aggregate.md](./aggregate.md) | `platform/domain/todo/task/task.ar.ts` |
| events | [events.md](./events.md) | `platform/domain/todo/task/task.events.ts` |
| errors | [errors.md](./errors.md) | `platform/domain/todo/task/task.errors.ts` |
| policy и доменные правила | [policy.md](./policy.md) | `platform/domain/todo/task/task.policy.ts`, `task.rules.ts` |
| repo / dcs / dqs | [repo.md](./repo.md) | `backend/todo/task/task.repo.ts`, `platform/domain/todo/task-release.dcs.ts` |
| facade (без манифеста, D-42) | [facade.md](./facade.md) | `backend/todo/todo.facade.test.ts` |
| use case (command, query) | [use-case.md](./use-case.md) | `platform/domain/todo/task/uc/*`, `backend/todo/task/uc/*` |
| event reaction | [event-reaction.md](./event-reaction.md) | `release-removed-user-tasks.er.ts` |
| module | [module.md](./module.md) | `platform/domain/todo/todo.module.ts`, `platform/domain/todo/contract.ts` |
| job | [job.md](./job.md) | `archive-done-tasks.job.ts` |
| сборка и раннер (корень сборки, D-50, D-106) | [app.md](./app.md) | `runners/assembly/example-app.ts`, `runners/cli/example-cli.ts` |
| проект: профили `init`, рост, подключение модулей | [project.md](./project.md) | каркас `dmg-core init --profile` |
| вынос модуля в сервис, модуль на другом языке (GR-01, GR-02; вживую не проверено) | [extract-module.md](./extract-module.md) | — |
| делегирование: заявка, порт, резолвер (D-89) | [delegation.md](./delegation.md) | `runners/assembly/example-caller-resolver.ts`, `runners/assembly/example-delegation-store.ts` |
| расширение графа и проверок: свой вид Def, поставщик, правило, слой, подписка | [graph-extension.md](./graph-extension.md) | `screen/screen-provider.ts`, `screen.test.ts` |

Без отдельного гайда: тесты — [testing.md](../reference/testing.md); поля `F.*` и `shared/` — [manifests.md](../reference/manifests.md) §3; формат графа — [graph.md](../reference/graph.md); структура и имена — [naming.md](../reference/naming.md).
