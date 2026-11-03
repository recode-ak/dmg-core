import type { EventBus } from './event-bus';
import type { EventEnvelope } from './event-envelope';

/**
 * Порт outbox (D-47): конверты записанных агрегатов одной фиксации — одной
 * партией, по порядку записи; до шины их доставляет реализация. Сбой `put` —
 * исключение фиксации. @see docs/concepts/aggregate-lifecycle.md
 */
export type Outbox = {
  put(envelopes: readonly EventEnvelope[]): Promise<void>;
};

/**
 * Outbox в процессе по умолчанию (D-47): публикует партию в шину сразу —
 * поведение то же, что до outbox.
 */
export class InProcOutbox implements Outbox {
  constructor(private readonly bus: EventBus) {}

  async put(envelopes: readonly EventEnvelope[]): Promise<void> {
    for (const envelope of envelopes) this.bus.publish(envelope);
  }
}
