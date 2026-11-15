---
covers:
  - src/app/oplog/**
  - src/kernel/schema/sensitive-mask.ts
  - src/cli/oplog-command.ts
---

# Лог операций

**Назначение:** что пишет лог операций, как скрываются персональные данные и как читать лог при расследовании. Решения — D-43, D-73, D-86 ([decisions.md](../decisions.md)).

---

## 1. Запись

Каждая операция (UC, ER, Job) последним шагом пишет одну запись `OperationRecord` в `OperationLog` из `AppContext` — при успехе и при отказе. Реализация пакета — `JsonlOperationLog` из `dmg-core/app`: файл на день UTC `YYYY-MM-DD.jsonl`, строка — запись.

| Поле | Что |
|---|---|
| `at`, `durationMs` | начало и длительность (0,1 мс) |
| `module`, `op`, `kind` | операция: `useCase`, `eventReaction`, `job`, `app` |
| `caller` | `Caller.toLog()` — кто ([caller.md](./caller.md)) |
| `trace` | `requestId`, `correlationId` — общий у цепочки, `cause` — породившее событие |
| `input` | вход как пришёл (ER — конверт события, Job — `null`), с маскированием |
| `result` | `{ ok: true, output }` — выход команды; у query — сводка `{ ok: true, size }`; `{ ok: false, error: { code, kind, payload } }` |
| `events` | опубликованные события — `name`, `eventId` |
| `writes` | записанные агрегаты: `{ aggregate, uuid, from, to, changes? }` — версии до и после; `from: null` — создан |

**Патч `changes`** — что изменилось в state между загрузкой и записью: `{ path, from, to }`. Объекты разбираются по полям (`profile.telegram`), массив и примитив — одно значение. У созданного агрегата — поля верхнего уровня без `from`. Служебные поля (`uuid`, `version`, `createdAt`, `updatedAt`) не входят, у query патча нет. Считает `UnitOfWork.commit` между `save` и `markStored`: база — `Aggregate.baselineState` (ссылка на состояние при загрузке или последней записи), текущее — `Aggregate.currentState`. Оба геттера читает только UoW (обращение вне `src/app/uow/**` пакета — lint DOM-17); состояние наружу отдаёт `view()`.

**Пороги** `JsonlOperationLog(dir, options)`:

| Опция | По умолчанию | Что |
|---|---|---|
| `maxBytes` | 8 КБ | `input`, `output`, `payload` ошибки длиннее — `TruncatedValue` (усечённый JSON) |
| `valueMaxBytes` | 1024 | `from`/`to` патча длиннее — `ValueDigest { digest: true, size, hash }` (sha256, 12 hex): виден факт замены, одинаковые значения сравнимы между записями |
| `retainDays` | без удаления | целое ≥ 1: при смене дня удаляются файлы дней старше N (остаются N дней, включая текущий); «сегодня» — меньший из дня записи и дня системных часов |

Сбой записи лога, расчёта патча или маскирования операцию не ломает: `warn` в логгер.

## 2. Персональные данные

Поле с персональными данными помечается на схеме один раз — `F.sensitive(schema)` в state или VO:

```ts
export const TaskState = v.object({
  ...BaseEntityFields,
  ownerId: F.uuid('владельца'),
  title: F.sensitive(F.string('Название задачи')),
  status: TaskStatus,
});
```

Образец — `TaskState` учебного модуля (`src/testing/example/todo/task/task.state.ts`), сквозной тест «в строке JSONL нет значения» — `example-app.test.ts`.

Пометка — метаданные схемы, поэтому переходит во все схемы, собранные из этих полей: выход UC из state или `view()`, вход из VO, payload событий и ошибок. Схема, написанная заново (не из полей state/VO), пометку не наследует — её помечают сами.

Маскирует `RecordMask` в `OperationRun` перед записью:

| Где | По какой схеме |
|---|---|
| `input` UC | вход UC |
| `input` ER | только `payload` конверта — по схеме события из `on` |
| `output` UC | выход UC |
| `payload` ошибки | по `code` из `errors` UC и `CoreErrors`; код неизвестен — payload целиком `'[redacted]'` |
| `changes` | помеченное поле или лист с помеченным внутри — `{ path, redacted: true }`, без значений и хеша (короткие значения подбираются по хешу) |

Помеченное значение — `'[redacted]'`; ключи вне схемы (лишние поля сырого входа) — как есть. Обход `SensitiveMask` (`dmg-core`): `object` и его виды, `array`, `tuple`, `record`, `optional`/`nullable`/`nullish`, `pipe` (метка в любом элементе), `variant` (ветка по дискриминатору), `union` (пометка хотя бы в одной ветке). Неизвестный вид схемы с вложенными схемами (`lazy`, `intersect`) и любой сбой маскирования записи — значения `input`, `output`, `payload` целиком `'[redacted]'` и `warn`: при сомнении — не писать. Сбой расчёта патча — записи без `changes` и `warn`. Маскирование идёт по форме выхода после `transform`: поле, которое `transform` переименовывает, пометку теряет.

## 3. Чтение

CLI — только чтение:

```bash
dmg-core oplog <dir> [--request id] [--aggregate uuid] [--subject id] \
  [--module m] [--op o] [--failed] [--since d] [--until d] [--json]
```

| Флаг | Что |
|---|---|
| `--request` | цепочка по `trace.correlationId`: операция, её реакции, Job, вложенные вызовы |
| `--aggregate` | история агрегата: записи с ним в `writes`, под каждой — версии и патч |
| `--subject` | действия субъекта (`subjectId` вызывающего; у system — исходного человека) |
| `--module`, `--op`, `--failed` | модуль, операция, только отказы |
| `--since`, `--until` | `YYYY-MM-DD` — день UTC включительно; ISO-время — точно (без смещения — UTC) |
| `--json` | исходные записи построчно вместо ленты |

Фильтры складываются по И, файлы вне диапазона дат не читаются. Лента — строка на запись (читатель сортирует по `at`): время UTC, вид, `модуль.операция`, кто, итог; с `--aggregate` — `1 → 2`, `path: "a" → "b"`, `path: [скрыто]`, `path: заменено, N байт, hash`. Неверный флаг, дата или нет каталога — код 2 и подсказка.

Без CLI — `OperationLogReader` (`read(filter)`) и `OperationLogFeed` (`lines(records, { aggregate })`) из `dmg-core/app`. Старые записи без `writes` и `changes` читаются; битая строка или строка без `at`/`module`/`op`/`kind` пропускается с `warn` (файл и номер строки).
