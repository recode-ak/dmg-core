import type { CallerLog, OperationRef } from '#core/kernel/caller/caller';
import type { DomainError } from '#core/kernel/errors/error';
import type { Timestamp } from '#core/kernel/time/timestamp';
import type { TraceLog } from '#core/kernel/trace/trace';
import type { PublishedEvent } from '../events/event-envelope';
import type { AggregateWrite } from '../uow/unit-of-work';

/**
 * Крупное значение патча в JSONL (D-85): размер JSON в байтах UTF-8 и
 * первые 12 hex sha256 — одинаковые значения видны по совпадению `hash`.
 */
export type ValueDigest = {
  readonly digest: true;
  readonly size: number;
  readonly hash: string;
};

/** Изменённое помеченное поле: без значений и хеша. */
export type RedactedChange = {
  readonly path: string;
  readonly redacted: true;
};

/**
 * Запись лога операций (D-43, Р6; D-73): один вызов UC, одна реакция ER или
 * один прогон Job — кто, по какой причине, с каким входом, чем закончился,
 * какие агрегаты записал и какие события опубликовал. Аудит «кто породил
 * событие» — через запись операции с этим `eventId`.
 */
export type OperationRecord = {
  /** Начало операции по часам приложения. */
  readonly at: Timestamp;
  readonly module: string;
  readonly op: string;
  readonly kind: OperationRef['kind'];
  readonly caller: CallerLog;
  readonly trace: TraceLog;
  /** Вход как пришёл: UC — до схемы, ER — событие, Job — `null`. */
  readonly input: unknown;
  /**
   * Итог. Выход команды — целиком; query — сводкой: размер JSON выхода в
   * байтах UTF-8 (выход — производная от state, D-73).
   */
  readonly result:
    | { readonly ok: true; readonly output: unknown }
    | { readonly ok: true; readonly size: number }
    | { readonly ok: false; readonly error: DomainError };
  readonly events: readonly PublishedEvent[];
  /** Записанные агрегаты всех UoW операции; пусто — операция только читала. */
  readonly writes: readonly AggregateWrite[];
  /** Длительность по монотонным часам процесса, мс, до 0,1. */
  readonly durationMs: number;
};

/**
 * Порт лога операций в `AppContext`. Пишет база операции
 * (`OperationFromDef`) последним шагом; сбой записи операцию не ломает.
 */
export interface OperationLog {
  append(record: OperationRecord): Promise<void>;
}
