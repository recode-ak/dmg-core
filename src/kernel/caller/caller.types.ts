/**
 * Пользователь так, как его видит ядро (D-04): только идентификатор — для
 * записи вызывающего в лог (`toLog`). Полный тип замыкает приложение.
 */
export type Identified = { readonly uuid: string };

/** Вид вызывающего — класс `Caller` и запись в логе операций. */
export type CallerKind = 'guest' | 'user' | 'delegate' | 'system';

/**
 * Вид вызывающего, который объявляет `callers` в Def UC (MAN-11, D-89):
 * заместитель допускается как `user` и отдельно не перечисляется.
 */
export type DeclaredCaller = 'guest' | 'user' | 'system';

/**
 * Ссылка на операцию приложения (D-51): UC, ER или Job своего или другого
 * модуля, либо вход корня сборки (`app`: `module` — имя приложения, `name` —
 * имя входа, например резолвер `Caller`). Свой ли модуль — сравнение
 * `module` с модулем вызываемого; вызов от приложения всегда чужой.
 */
export type OperationRef = {
  readonly kind: 'useCase' | 'eventReaction' | 'job' | 'app';
  readonly module: string;
  readonly name: string;
};

/** Вызывающий в форме для лога операций. */
export type CallerLog =
  | { readonly kind: 'guest' }
  | { readonly kind: 'user'; readonly subjectId: string }
  | {
      readonly kind: 'delegate';
      readonly subjectId: string;
      readonly actorId: string;
      readonly delegationId: string;
      readonly readOnly?: boolean;
    }
  | {
      readonly kind: 'system';
      readonly from: OperationRef;
      readonly person?: CallerLog;
    };

/** Гость в JSON. */
export type GuestCallerJson = { readonly kind: 'guest' };

/** Пользователь в JSON: субъект целиком (D-46). */
export type UserCallerJson<U> = { readonly kind: 'user'; readonly user: U };

/**
 * Заместитель в JSON (D-89): замещаемый и заместитель целиком. `readOnly`
 * пишется только при `true`: запись без поля — обычный заместитель.
 */
export type DelegateCallerJson<U> = {
  readonly kind: 'delegate';
  readonly principal: U;
  readonly actor: U;
  readonly delegationId: string;
  readonly readOnly?: boolean;
};

/** Человек на входе в JSON — то, что может стоять за системным. */
export type PersonCallerJson<U> =
  | GuestCallerJson
  | UserCallerJson<U>
  | DelegateCallerJson<U>;

/** Системный вызывающий в JSON; человек — без матрёшки. */
export type SystemCallerJson<U> = {
  readonly kind: 'system';
  readonly from: OperationRef;
  readonly person?: PersonCallerJson<U>;
};

/**
 * Вызывающий в JSON — для передачи через границу процесса (D-46):
 * `toJSON()` у отправителя, `Caller.fromJSON()` у получателя.
 */
export type CallerJson<U = Identified> =
  | PersonCallerJson<U>
  | SystemCallerJson<U>;
