import type * as v from 'valibot';
import type { AnyOperationDef } from '#core/domain/contracts/operation-def.types';
import type { AnyEventDef } from '#core/domain/events/event-def';
import { CoreErrors } from '#core/kernel/errors/core-errors';
import type { DomainError } from '#core/kernel/errors/error';
import type { AnyErrorDef } from '#core/kernel/errors/error-def';
import { REDACTED, SensitiveMask } from '#core/kernel/schema/sensitive-mask';
import type { OperationRecord } from './operation-record';

const CORE_ERRORS: readonly AnyErrorDef[] = Object.values(CoreErrors);

/**
 * Маскирование записи лога по Def операции (D-86): поля `F.sensitive` —
 * `'[redacted]'`. UC — вход, выход и payload ошибки; ER — только `payload`
 * конверта события; Job схем не имеет. `writes` маскирует UoW. Payload
 * ошибки с кодом вне `errors` и `CoreErrors` (вложенный вызов) скрывается
 * целиком: его схемы нет.
 * @see src/app/oplog/record-mask.test.ts
 */
export class RecordMask {
  private readonly mask: SensitiveMask;

  private constructor(
    private readonly def: AnyOperationDef,
    private readonly warn?: (message: string) => void,
  ) {
    this.mask = new SensitiveMask(warn);
  }

  /** Маска для операции `def`; `warn` — о сбое маскирования. */
  static of(def: AnyOperationDef, warn?: (message: string) => void) {
    return new RecordMask(def, warn);
  }

  /**
   * Копия записи с замаскированными `input`, выходом и payload ошибки. Сбой
   * не ломает операцию: все три скрываются целиком, `warn`.
   */
  apply(record: OperationRecord): OperationRecord {
    try {
      return {
        ...record,
        input: this.input(record.input),
        result: this.result(record.result),
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.warn?.(`Маскирование записи: ${reason} — значения скрыты целиком`);
      return { ...record, input: REDACTED, result: redacted(record.result) };
    }
  }

  private input(input: unknown): unknown {
    const { def } = this;
    if (def.dmg === 'useCase') return this.mask.apply(def.input, input);
    if (def.dmg === 'eventReaction') return this.envelope(def.on, input);
    return input;
  }

  /** Конверт события: маскируется только `payload` схемой события по имени. */
  private envelope(on: readonly AnyEventDef[], input: unknown): unknown {
    if (typeof input !== 'object' || input === null || !('payload' in input)) {
      return input;
    }
    const name = 'name' in input ? input.name : undefined;
    const event = on.find((e) => e.name === name);
    const payload =
      event === undefined
        ? REDACTED
        : this.mask.apply(event.payload, input.payload);
    return { ...input, payload };
  }

  private result(result: OperationRecord['result']): OperationRecord['result'] {
    const { def } = this;
    if (!result.ok) return { ok: false, error: this.error(result.error) };
    if (def.dmg !== 'useCase' || !('output' in result)) return result;
    return { ok: true, output: this.mask.apply(def.output, result.output) };
  }

  private error(error: DomainError): DomainError {
    if (error.payload === undefined) return error;
    const schema = this.payloadSchema(error.code);
    if (schema === null) return { ...error, payload: REDACTED };
    if (schema === undefined) return error;
    return { ...error, payload: this.mask.apply(schema, error.payload) };
  }

  /** Схема payload по коду: `null` — код неизвестен, `undefined` — без payload. */
  private payloadSchema(code: string): v.GenericSchema | undefined | null {
    const own = this.def.dmg === 'useCase' ? this.def.errors : [];
    const found = [...own, ...CORE_ERRORS].find((e) => e.code === code);
    return found === undefined ? null : found.payload;
  }
}

function redacted(
  result: OperationRecord['result'],
): OperationRecord['result'] {
  if (!result.ok) {
    return { ok: false, error: { ...result.error, payload: REDACTED } };
  }
  return 'output' in result ? { ok: true, output: REDACTED } : result;
}
