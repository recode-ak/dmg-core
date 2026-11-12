---
covers:
  - src/domain/contracts/job-def*.ts
  - src/app/job/**
---

# Job — гайд

**Назначение:** периодическая операция модуля — контракт `<N>JobDef = JobDef.define(...)` (`<domain>/<m>/<a>/job/<n>.job.ts`) и реализация `<N>Job extends JobFromDef` (`<app>/<m>/<a>/job/<n>.job.ts`).

---

## 1. Когда применять

- Действие по расписанию, без вызывающего и без события: обход агрегатов (`scans`), напоминания, архивация. Ответ на событие — ER ([event-reaction.md](./event-reaction.md)); действие человека — UC ([use-case.md](./use-case.md)).
- Job техничен (API-01): отбор — выборкой репозитория, решение — методом Ar или DCS.

## 2. Команда

`dmg-core gen job <m>.<a> <имя> --write` — пара Def + реализация с тестами, строки в `<M>ModuleDef.jobs` и в карте модуля ([module.md](./module.md)).

## 3. Образец

- [archive-done-tasks.job.ts (Def)](../../src/testing/example/todo/task/job/archive-done-tasks.job.ts): `schedule` (`dailyAt`, UTC), `scans: [TaskArDef]`, `emits: [TaskEvents.archived]`.
- [archive-done-tasks.job.ts (реализация)](../../src/testing/example/app/todo/task/job/archive-done-tasks.job.ts): `run(job)` → выборка `findDone` → `job.forEach` (UoW на запись) → `TaskAr.archive` → `uow.register`.
- [archive-done-tasks.job.test.ts](../../src/testing/example/app/todo/task/job/archive-done-tasks.job.test.ts): архив выполненных, повторный прогон пуст, сбой одной записи не прерывает обход (`failed: 1` и лог).
- Запуск — `ModuleFromDef.runJob`, след — `Trace.forJob` ([todo.module.test.ts](../../src/testing/example/app/todo/todo.module.test.ts)).

## 4. Чеклист правил

- API-01 — Job техничен: отбор и решение — домен (метод Ar, DCS).
- API-06 — Job идемпотентен; ошибка одной записи не прерывает обход; пороги — экспортируемые константы; расписания UTC.
- MAN-04, MAN-05 — только события из `emits`, вызовы из `calls`; MAN-13 — `scans` — агрегаты своего модуля.

## 5. Типичные ловушки

- Один UoW на весь обход → сбой одной записи обрывает фиксацию остальных (записанные до неё остаются); `job.forEach` даёт UoW на каждую запись.
- Отбор «что пора обработать» `if`-ом в Job → выборка порта или метод-вопрос Ar.
- `Date.now()` внутри цикла → `this.now()`; порог — экспортируемая константа.

## 6. Как тестировать

Обработка подходящих записей и пропуск остальных; повторный прогон ничего не пишет; сбой одной записи — остальные обработаны, отчёт `failed` и `logger.error`; запуск через модуль — `runJob`. Репозиторий — фейк порта ([task.repo.fake.ts](../../src/testing/example/app/todo/task/task.repo.fake.ts)): выборку задаёт тест присваиванием, сбой записи — `failOn(uuid)` ([testing.md](../reference/testing.md)).

## 7. Запуск по расписанию

Планировщик — часть платформы (`dmg-core/app`), приложение его собирает и запускает (D-71).

- **Вход.** `new InProcJobScheduler({ api, modules, clock, logger, store?, startDelayMs? })`: `api` — `Pick<ApiApp, 'runJob'>`, `modules` — Def подключённых модулей, задания берутся из их `jobs`; `store` — история прогонов (`JobRunRepo`), по умолчанию `MemoryJobRunRepo` (живёт до рестарта). Порт — `JobScheduler { start(); stop() }`: повторный `start()` без `stop()` — исключение, `stop()` идущий прогон не прерывает.
- **Время — `Timestamp`** (мс UTC, D-34): `JobSchedulePlanner.nextRunAfter(schedule, after): Timestamp`, `JobRunRepo.getLastRunAt(name): Timestamp | undefined`; `Date` — только внутри календарной арифметики (`Date.UTC`, `getUTC*`).
- **Ключ истории — `def.name`** задания: два задания с одним именем в `modules` — ошибка конфигурации в `start()`.
- **Догон упущенного.** Расписание считается от фактического конца прогона; упущенный запуск выполняется один раз через стартовую задержку `DEFAULT_START_DELAY_MS` (3 мин), сколько бы ни пропущено; `runAtStart` без истории — тоже через неё. Тик во время прогона того же задания пропускается.
- **Параллельные прогоны.** В пределах одного `start()` их нет: тик во время прогона пропускается; `stop()` и новый `start()` во время идущего прогона могут запустить то же задание параллельно (идущий прогон `stop()` не прерывает).
- **Сбой прогона.** `Err` из `runJob` и исключение — `logger.warn` источника `job-runner`; `lastRunAt` пишется всё равно, чтобы рестарт не зацикливал догон.
- Реализация — `src/app/job/`, тесты рядом: `job-schedule-planner.test.ts`, `scheduled-job-runner.test.ts`, `in-proc-job-scheduler.test.ts`.
