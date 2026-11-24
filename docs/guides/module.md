---
covers:
  - src/domain/contracts/module-def*.ts
  - src/app/module/**
  - src/gen/kinds/module.ts
  - src/gen/kinds/app-module.ts
verified: 06429f5
---

# Module — гайд

**Назначение:** паспорт модуля — контракт `<M>ModuleDef = ModuleDef.define(...)` (`<domain>/<m>/<m>.module.ts`), вход для остального кода `<domain>/<m>/contract.ts` и реализация — карта «Def → класс» с `create<M>Module(deps)` (`<backend>/<m>/<m>.module.ts`); сборка модулей — в приложении ([app.md](./app.md)).

---

## 1. Когда применять

- Модуль есть всегда: в паспорте — `dependsOn`, агрегаты, UC, ER, Job; всё, что не перечислено, в граф и приложение не попадает (MAN-06).
- Вход для остального кода — `contract.ts` (D-45): `<M>ModuleDef`, Def UC, которые зовут снаружи, события, ошибки, VO их схем; Ar, Policy, доменные правила и DQS — если они нужны зависимым модулям или клиентскому коду адаптеров (чужой код видит Ar как `ReadonlyAr`, D-69, D-104) — с JSDoc «кто и зачем» (D-74). DCS, ArDef и схем entity в нём нет. `index.ts` — для своего пакета реализации.
- Зависимость реализована вне приложения (ещё не переведённый код, другой сервис) — внешний модуль `ModuleDef.define({ external: true, … })` в её `contract.ts` (D-37): агрегаты с событиями, Def UC без реализации, без ER/Job; события публикует внешняя сторона.
- Фасад — только по потребителю ([facade.md](./facade.md)): модулю без вызывающих фасад не нужен.
- Вход в UC модуля — команда (D-49): `module.dispatch(ucDef.command(input), caller, trace)`. UC модуль находит по имени из команды; неизвестное имя (команда клиента другой версии) — `Err` `OPERATION_NOT_FOUND` с `{ module, uc }`. Модуль адресует транспорт (приложение — по имени модуля), а не команда. Job — `runJob`, реакции — `subscribe`. Снаружи модуля в процессе команду отдаёт приложение (`apiApp.dispatch(moduleDef, …)`), вне процесса — `ModuleApi` (`reference/transport.md` §4).

## 2. Команда

`dmg-core gen module <m> --write` — паспорт, контракт (только паспорт, D-45) и тест в домене, карта и тест в пакете реализации модуля. Строки в `useCases`/`reactions`/`jobs` и в карте дописывают `dmg-core gen uc|er|job` по маркерам `// gen:defs:*`; руками — только `dependsOn`, `label`, `description`.

## 3. Образец

- [todo.module.ts (Def)](../../src/testing/example/platform/domain/todo/todo.module.ts): `dependsOn: [UsersModuleDef]` из контракта `users`, UC, ER и Job.
- [todo/contract.ts](../../src/testing/example/platform/domain/todo/contract.ts) и [users/contract.ts](../../src/testing/example/platform/domain/users/contract.ts): входы модулей с JSDoc на каждом экспорте; `todo` отдаёт и `TaskAr`, `TaskPolicy`, `TaskRules` с типами контекстов и `OPEN_TASKS_LIMIT` — клиентскому коду (D-104), но не state, ArDef и DCS; `users` отдаёт `GetUserUcDef` и тип ответа `UserActivity`, но не state, Ar и Policy.
- [todo.module.ts (реализация)](../../src/testing/example/backend/todo/todo.module.ts): `TodoDeps = ModuleDeps & { tasks }`, `todoMap … satisfies ModuleMap<…>`, `createTodoModule(deps)` → `ModuleFromDef`.
- [example.arch.ts](../../src/testing/example/example.arch.ts): `ArchApp` учебного приложения — раскладка и `entry: 'contract'` для ARC-04.
- [example.app.ts](../../src/testing/example/platform/domain/example.app.ts): `AppDef` — полный состав модулей приложения; `gen module` добавляет в него Def нового модуля.
- Минимальный модуль-владелец: [users.module.ts](../../src/testing/example/platform/domain/users/users.module.ts) и [реализация](../../src/testing/example/backend/users/users.module.ts).

## 4. Чеклист правил

- ARC-04, ARC-05 — `dependsOn` объектами Def из контрактов, граф без циклов; импорт другого модуля — только через `contract` и только из `dependsOn`.
- ARC-06 — пакет реализации модуля не импортирует другие пакеты реализаций: чужие модули — только `ModuleFacades` в `deps`.
- API-05 — карта типизирована `satisfies ModuleMap<typeof <M>ModuleDef, <M>Deps, …>`; класс без Def в карте — ошибка типа.
- MAN-01, MAN-06 — у паспорта `label`/`description`; каждый Def модуля в паспорте.
- MAN-05 — `calls` операций только из модулей `dependsOn` (`ArchChecker`).
- MAN-13 — один UoW — один модуль.

## 5. Типичные ловушки

- Старый обработчик и модуль на Def подписаны на одно событие одновременно — двойная обработка; при переключении старый убирается тем же изменением.
- Резолвер приложения с лишними полями вместо `ModuleDeps` фреймворка и своих репозиториев — модуль начинает зависеть от приложения.
- Лог операций тестов в рабочих данных → временный каталог или `MemoryOperationLog`.
- Строковое имя UC или команда, собранная руками, вместо `ucDef.command(input)` при вызове из UI; `Caller` и `Trace` строятся в одном месте входа, а не в каждой story.
- `external` у модуля с реализацией — его ER и Job не попадут в граф; `external` снимается при переводе модуля на Def, контракт остаётся.

## 6. Как тестировать

Домен — `normalize(<M>ModuleDef)` (состав паспорта) и `ArchChecker.defsOf([…]).report()` без нарушений ([todo.module.test.ts](../../src/testing/example/platform/domain/todo/todo.module.test.ts), [users.module.test.ts](../../src/testing/example/platform/domain/users/users.module.test.ts)). Пакет реализации — модуль на настоящем репозитории во временном каталоге (в тестах UC/ER/Job — фейк порта, [testing.md](../reference/testing.md) §4), фасады — `StubFacade` по Def, вызовы через `dispatch` команды, `runJob`, доставка события через `subscribe` ([todo.module.test.ts](../../src/testing/example/backend/todo/todo.module.test.ts)).
