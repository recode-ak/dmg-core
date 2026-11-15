import * as v from 'valibot';
import type { Err, Result } from '#core/kernel/result/result';
import type { Timestamp } from '#core/kernel/time/timestamp';
import type {
  EventsOf,
  RejectOf,
  StateOf,
  TransitionOf,
} from './aggregate.types';
import type { AnyAggregateDef, EntityBase } from './aggregate-def';
import type { ReadonlyAr } from './readonly-ar';

/**
 * Метка «создан, а не восстановлен» от `Aggregate.newState`: символьный ключ
 * переживает spread в `create`, но не схему, `snapshot()` и JSON. Так база
 * отличает `create` от `restore` без флага в конструкторе наследника.
 */
const NEW_ENTITY: unique symbol = Symbol('dmg.newState');

function isNewEntity(state: object): boolean {
  return NEW_ENTITY in state;
}

/**
 * Класс агрегата с `static restore(snapshot)` — как его объявляет Ar.
 * Свойство, а не метод: параметр строго контравариантен, и state другого
 * агрегата не пройдёт.
 */
type Restorable<S, A> = { readonly restore: (snapshot: S) => A };

type Emit<D extends AnyAggregateDef> = (event: EventsOf<D>) => void;

type Apply<D extends AnyAggregateDef, R> = (
  draft: StateOf<D>,
  emit: Emit<D>,
) => R;

/**
 * Базовый класс агрегата (D-44). Наследник объявляет `private constructor`,
 * `static create(): Result<Ar>` и `static restore(snapshot)`. Состояние
 * меняется только мутациями базы; невалидное — `throw`, в памяти его не
 * бывает. `V` — форма состояния наружу (`view()`), по умолчанию — state.
 */
export abstract class Aggregate<D extends AnyAggregateDef, V = StateOf<D>> {
  private live: StateOf<D>;
  private base: StateOf<D> | undefined;
  private pending: EventsOf<D>[];
  private stored: number | undefined;

  /**
   * Агрегат только для чтения из state (D-43) — так потребитель фасада видит
   * выход UC другого модуля, а не entity (API-04). Полиморфный `this`: тип и
   * проверка state — по `restore` конкретного Ar, кода в наследнике не нужно.
   */
  static readonly<S, A>(
    this: Restorable<S, A>,
    state: NoInfer<S>,
  ): ReadonlyAr<A> {
    // biome-ignore lint/complexity/noThisInStatic: полиморфный `this` — restore конкретного Ar, а не базы
    return this.restore(state);
  }

  /**
   * Базовые поля state нового агрегата: создан и изменён в `at`, версия 0.
   * `create` наследника обязан строить state через неё
   * (`{ ...XAr.newState(uuid, at), … }`) — иначе агрегат считается
   * восстановленным, и первая запись даст `VersionConflict` (записи нет).
   */
  protected static newState(uuid: string, at: Timestamp): EntityBase {
    const base: EntityBase = { uuid, createdAt: at, updatedAt: at, version: 0 };
    return Object.assign(base, { [NEW_ENTITY]: true });
  }

  protected constructor(
    private readonly def: D,
    state: StateOf<D>,
    events: readonly EventsOf<D>[] = [],
  ) {
    this.live = this.validate(state);
    this.pending = [...events];
    const created = isNewEntity(state);
    this.stored = created ? undefined : this.live.version;
    this.base = created ? undefined : this.live;
  }

  get uuid(): string {
    return this.live.uuid;
  }

  /** Имя Def агрегата — для ошибок о записи (`VERSION_CONFLICT`, D-57). */
  get aggregateName(): string {
    return this.def.name;
  }

  /** Текущая версия: растёт с каждой мутацией (D-36). */
  get version(): number {
    return this.live.version;
  }

  /**
   * Версия, с которой агрегат загружен или последний раз сохранён, — её
   * репозиторий сверяет с хранилищем перед записью (`VersionConflict`).
   * `undefined` — агрегат создан (`create`) и ещё не записан: записи с его
   * uuid в хранилище быть не должно.
   */
  get storedVersion(): number | undefined {
    return this.stored;
  }

  /** Отметить запись: вызывает UoW после успешного `repo.save`. */
  markStored(): void {
    this.stored = this.live.version;
    this.base = this.live;
  }

  /**
   * Состояние на момент загрузки или последней записи — база патча в логе
   * операций (D-86); `undefined` — создан и не записан. Ссылка, не копия:
   * только для UoW и лога (lint DOM-17), не мутировать.
   */
  get baselineState(): Readonly<StateOf<D>> | undefined {
    return this.base;
  }

  /**
   * Текущее состояние — вторая сторона патча. Ссылка, не копия:
   * мутация строит новый объект, база не меняется; только для UoW (DOM-17).
   */
  get currentState(): Readonly<StateOf<D>> {
    return this.live;
  }

  /**
   * Копия состояния для записи — вызывает только репозиторий (DOM-17,
   * D-44). Наружу состояние отдаёт `view()`.
   */
  snapshot(): StateOf<D> {
    return structuredClone(this.live);
  }

  /**
   * Состояние наружу (D-44): выход UC, рендереры UI. По умолчанию — копия
   * state. Агрегат, объявивший свою форму `V`, переопределяет `view()` и
   * собирает объект явно (не `{ ...this.state }`).
   */
  view(): V {
    return this.snapshot() as unknown as V;
  }

  /** Выдать накопленные события и очистить накопитель (вызывает UoW). */
  pullEvents(): EventsOf<D>[] {
    const events = this.pending;
    this.pending = [];
    return events;
  }

  /** Текущее состояние — для методов-вопросов наследника. */
  protected get state(): Readonly<StateOf<D>> {
    return this.live;
  }

  /**
   * Мутация без смены статуса в момент `at` (D-34): черновик → `apply` →
   * проверка схемы → фиксация; при `Err` черновик и события отбрасываются.
   * Дженерик по всему `Result`: при `<T, E>` TS вывел бы `E` из первого
   * `return` и отверг бы второй код ошибки.
   */
  protected change<R extends Result<unknown, unknown>>(
    at: Timestamp,
    apply: Apply<D, R>,
  ): R {
    return this.mutate(at, apply, undefined);
  }

  /**
   * Переход статуса `op` по Def: из статуса вне `from` — отказ из `rejects`,
   * иначе черновик получает статус `to` и проходит `apply`, как в `change`.
   * Правила жизненного цикла живут в Def; метод Ar пишет только сам переход.
   */
  protected transition<
    K extends TransitionOf<D>,
    R extends Result<unknown, unknown>,
  >(op: K, at: Timestamp, apply: Apply<D, R>): R | Err<RejectOf<D, K>> {
    const declared = this.def.transitions?.[op];
    if (declared === undefined) {
      throw new Error(`Агрегат ${this.def.name}: переход ${op} не объявлен`);
    }
    const from = statusOf(this.live);
    if (from !== undefined && declared.from.includes(from)) {
      return this.mutate(at, apply, declared.to);
    }
    const reject = from === undefined ? undefined : declared.rejects[from];
    if (reject === undefined) {
      throw new Error(
        `Агрегат ${this.def.name}: у перехода ${op} нет отказа для статуса ${from}`,
      );
    }
    // Ключ `rejects[from]` — ошибка перехода `op`: тип выводит сигнатура,
    // рантайм-доступ по строке статуса его не сохраняет.
    return reject.err() as Err<RejectOf<D, K>>;
  }

  private mutate<R extends Result<unknown, unknown>>(
    at: Timestamp,
    apply: Apply<D, R>,
    to: string | undefined,
  ): R {
    const draft = structuredClone(this.live);
    const before = statusOf(draft);
    if (to !== undefined) Reflect.set(draft, 'status', to);
    const emitted: EventsOf<D>[] = [];
    const res = apply(draft, (event) => {
      emitted.push(event);
    });
    if (!res.ok) return res;
    this.checkStatus(to ?? before, statusOf(draft));
    this.live = this.validate({
      ...draft,
      updatedAt: at,
      version: this.live.version + 1,
    });
    this.pending.push(...emitted);
    return res;
  }

  private validate(state: unknown): StateOf<D> {
    const parsed = v.safeParse(this.def.state, state);
    if (!parsed.success) {
      throw new Error(
        `Агрегат ${this.def.name}: состояние не прошло схему — ${v.summarize(parsed.issues)}`,
      );
    }
    return parsed.output;
  }

  /** Статус после `apply` — тот, что поставила база (или прежний). */
  private checkStatus(
    expected: string | undefined,
    actual: string | undefined,
  ): void {
    if (expected === actual) return;
    throw new Error(
      `Агрегат ${this.def.name}: статус ${expected} → ${actual} изменён мимо transition — статус ставит база по Def`,
    );
  }
}

function statusOf(state: object): string | undefined {
  return 'status' in state && typeof state.status === 'string'
    ? state.status
    : undefined;
}
