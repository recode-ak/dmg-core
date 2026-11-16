# Caller и Trace

**Назначение:** контракт вызывающей стороны и следа для UC, Policy и аудита. Классы `Caller` и `Trace` — в `dmg-core` (дженерик пользователя замыкает пакет приложения). Решения — D-25, D-43, D-46, D-56, D-89 ([decisions.md](../decisions.md)).

---

## 1. Иерархия

`Caller<U>` — абстрактный класс; вид — `kind`, остальное — методы:

```ts
abstract class Caller<U extends { uuid: string }> {
  abstract readonly kind: 'guest' | 'user' | 'delegate' | 'system';
  abstract declaredKind(): 'guest' | 'user' | 'system'; // вид для callers; заместитель — 'user'
  abstract subject(): U | undefined;              // от чьего имени — для Policy и домена
  abstract person(): PersonCaller<U> | undefined; // исходный человек — для вложенных вызовов
  abstract toLog(): CallerLog;                    // форма для лога операций
}
type PersonCaller<U> = GuestCaller<U> | UserCaller<U> | DelegateCaller<U>;
```

| Класс | Кто | `subject()` | `person()` |
|---|---|---|---|
| `GuestCaller` | не зарегистрирован (канал — в `Trace.channel`) | нет | он сам |
| `UserCaller(user)` | авторизованный пользователь | он сам | он сам |
| `DelegateCaller(subject, actor, delegationId, readOnly = false)` | заместитель действует от имени другого по делегированию; `readOnly` — только query UC | **тот, кого замещают** | он сам |
| `SystemCaller(from, person?)` | UC/ER/Job своего или другого модуля; `from: OperationRef` — `{ kind, module, name }` вызвавшей операции | `person?.subject()` | `person` |

- `person` по типу не `SystemCaller`; вложенный вызов передаёт `caller.person()` пришедшего.
- ER и Job — `SystemCaller` без `person`; Job — не гость (гость — реальный посетитель). «Кто породил» ER — через `trace.cause` к записи операции-причины в логе операций.
- Свой или чужой модуль — сравнение `from.module` с модулем вызываемого; отдельного вида `module` нет.
- `toLog()`: `{ kind: 'guest' }` · `{ kind: 'user', subjectId }` · `{ kind: 'delegate', subjectId, actorId, delegationId, readOnly? }` (`readOnly: true` — только у заместителя на чтение; в `toJSON` так же) · `{ kind: 'system', from, person? }`.

## 2. Ключевые правила

1. Def UC объявляет допустимые виды: `callers: DeclaredCaller[]` (`'guest' | 'user' | 'system'`), сверка — по `declaredKind()`: заместитель проходит там, где `user`. Недопустимый вид отсекается до запуска UC (`UNAUTHORIZED`). Сужения для заместителя — сразу после `callers`, по `caller.person()` (прямо и за `SystemCaller`): UC с `personal: true` — `UNAUTHORIZED { reason: 'personal' }`; заместитель с `readOnly` на command UC — `UNAUTHORIZED { reason: 'readOnly' }`, query проходят. Шаг приватный — наследник не обходит его.
2. Policy и домен работают только с **субъектом** (`caller.subject()`): `Rule.evaluate(subject, ctx)`; вид вызывающего Policy не знает и делегирование не проверяет. Policy вызывается всегда; правило без субъекта — отказ (`ACCESS_DENIED`).
3. Системный вызов без субъекта разрешается только явно: отдельный UC (`callers: ['system']`, `allowAll`) или переопределение `protected checkPolicy` в наследнике `UseCaseFromDef` — ответственность наследника.
4. Межмодульный вызов — `this.call(def, input, caller, trace)` базы `OperationFromDef`: только Def из `calls` (по типу — UC с `'system'` в `callers`); база подставляет `SystemCaller(this.ref, caller.person())` и идёт через фасад модуля-владельца (`Facade<M>.handle`). Рантайм-проверки `calls` нет.
5. Конверт события несёт `cause` и `correlationId`, но не `caller`: «кто» — лог операций (`toLog()` вызывающего), «из-за чего» — `trace.cause`.
6. Транспорт строит `Caller` и `Trace` на входе (бот — по идентификатору пользователя в канале и заявке делегирования из сессии, HTTP — по токену) и исполняет команду `ModuleFromDef.dispatch` — через `apiApp.dispatch` по Def или `apiApp.dispatchByName` по имени модуля ([transport.md](./transport.md) §4); внутрь UC они передаются неизменными.
7. Резолвер приложения — `resolve(uuid, trace, claim?)` → `Result<PersonCaller, DelegationDenied>`: отказ делегирования — `err`, дефект — исключение (ERR-01). Резолвер каркаса `init` без модуля пользователей — заглушка: uuid из CLI → `UserCaller` без ролей, только канал `cli`; заявка → `DELEGATION_DENIED { reason: 'disabled' }`.

## 3. Trace

| Поле, метод | Значение |
|---|---|
| `requestId` | id входа транспорта (`Trace.fromRequest`); клиент не передал — создаётся с `warn` (ERR-07), причина получает `generated: true` (лог операций, `TraceJson`) |
| `clientRequestId` | `requestId`, присланный клиентом, — ключ отсева повторов command UC; у серверного id, следа события и Job его нет |
| `cause` | запрос, событие или прогон Job — шаг назад |
| `correlationId` | вся цепочка |
| `channel?` | `{ name, visitorId? }`, задаётся на входе, идёт по цепочке |
| `Trace.fromEvent` | след ER; канал события не переносится — в конверте его нет |
| `Trace.forJob(def)` | след Job; причина — прогон с именем Job |
| `toLog()` / `toEnvelope()` | форма для лога операций / для конверта события |
| `toJSON()` / `Trace.fromJSON` | след через границу процесса (`TraceJson`, D-46); не по схеме — исключение |

`Trace`, `TraceJson`, `Cause`, `TraceChannel`, `RequestMeta` отдаёт корень `dmg-core` и `dmg-core/app` (D-102); `TraceLog` и `TraceStamp` — только `dmg-core/app`.

## 4. Делегирование

Записи делегирований, их выдача и отзыв — модуль приложения; платформа читает запись через порт и строит вызывающего (D-89).

| Тип (`dmg-core/app`) | Что |
|---|---|
| `DelegationClaim` | заявка транспорта: `principalId`, `actorId`, `delegationId` |
| `DelegationRecord` | что читает платформа: пара, `expiresAt`, `revoked`, `readOnly` |
| `DelegationStore` | порт приложения: `find(delegationId)` → запись или `undefined` |
| `DelegationCheck(store?, clock)` | `verify(claim)` → запись или `DELEGATION_DENIED`: `disabled` → `invalid` (нет записи или чужая пара) → `revoked` → `expired` (`!(now < expiresAt)`) |

Резолвер (§2 п. 7) сверяет `actorId` с личностью от транспорта, загружает обоих пользователей и строит `DelegateCaller` с `readOnly` из записи. Проверка — на каждом запросе. Без порта делегирование не подключено: заявка — отказ `disabled`.
