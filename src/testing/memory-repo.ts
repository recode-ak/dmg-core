import {
  type StoredRecord,
  type Versioned,
  VersionedRepository,
} from '../app/uow/repository';
import type { AnyAggregateDef } from '../domain/aggregate/aggregate-def';

/** Снапшот, который хранит фейк: запись с uuid и версией (D-36). */
export type MemorySnapshot = StoredRecord & { readonly uuid: string };

/** Агрегат, который умеет фейк: сверка версии и снапшот для записи. */
export type MemoryAr<S extends MemorySnapshot> = Versioned & {
  snapshot(): S;
};

/**
 * Репозиторий в памяти для тестов UC/ER/Job: `save` со сверкой версии
 * (`VersionConflict`, D-36), хранит снапшоты, `restored` отдаёт новый Ar.
 * Выборку (`find*`) не реализует: ответ задаёт тест (`unanswered`), а
 * проверяет контрактный тест настоящего репозитория.
 * @see src/testing/example/app/todo/task/task.repo.fake.ts
 */
export class MemoryRepo<
  A extends MemoryAr<S>,
  S extends MemorySnapshot,
> extends VersionedRepository<A> {
  private readonly rows = new Map<string, S>();
  private readonly written: S[] = [];
  private readonly failing = new Set<string>();

  constructor(
    readonly aggregate: AnyAggregateDef,
    private readonly restore: (snapshot: S) => A,
  ) {
    super();
  }

  /** Снапшоты, записанные через `save`, по порядку; `seed` сюда не входит. */
  get saved(): readonly S[] {
    return this.written;
  }

  /** Начальные записи до вызова UC; запись с тем же uuid заменяется. */
  seed(...snapshots: S[]): this {
    for (const s of snapshots) this.rows.set(s.uuid, structuredClone(s));
    return this;
  }

  /** `save` агрегата с этим uuid бросает ошибку — сбой записи. */
  failOn(uuid: string): this {
    this.failing.add(uuid);
    return this;
  }

  /** Новый Ar из записи в памяти (seed или save); нет записи — `undefined`. */
  restored(uuid: string): A | undefined {
    const row = this.rows.get(uuid);
    return row && this.restore(structuredClone(row));
  }

  /** Как `restored`, но нет записи — исключение (ошибка теста). */
  restoredOrThrow(uuid: string): A {
    const ar = this.restored(uuid);
    if (ar === undefined) {
      throw new Error(`MemoryRepo ${this.aggregate.name}: нет записи ${uuid}`);
    }
    return ar;
  }

  /**
   * Метод порта без ответа: вызов — исключение с понятным текстом (ошибка
   * теста). Тест задаёт ответ присваиванием поля наследника.
   */
  protected unanswered<P extends unknown[], R>(
    method: string,
  ): (...args: P) => Promise<R> {
    return async () => {
      throw new Error(
        `MemoryRepo ${this.aggregate.name}: нет ответа для ${method}`,
      );
    };
  }

  protected async stored(uuid: string): Promise<StoredRecord | undefined> {
    return this.rows.get(uuid);
  }

  protected async write(ar: A): Promise<void> {
    if (this.failing.has(ar.uuid)) {
      throw new Error(
        `MemoryRepo ${this.aggregate.name}: сбой записи ${ar.uuid}`,
      );
    }
    const snapshot = ar.snapshot();
    this.rows.set(ar.uuid, snapshot);
    this.written.push(structuredClone(snapshot));
  }
}
