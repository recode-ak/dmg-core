// Подписка внешнего слоя на события (D-98): бот, web-UI, WebSocket-соединение.
// Не ER: нет Def, отсева повторов и своей записи в oplog; `Caller` выбирает
// обработчик. Сбой ловит сама подписка — поведение не зависит от шины.
import type { AnyEventDef } from '#core/domain/events/event-def';
import { Trace } from '#core/kernel/trace/trace';
import type { AppContext } from '../context';
import type { EventEnvelope } from './event-envelope';
import type { TracedHandler } from './event-subscriber.types';

/**
 * Один подписчик со сроком жизни своего канала (`source` — кто подписан).
 * Обработчик получает конверт и след события; сбой — в `logger.error`
 * без payload конверта.
 */
export class EventSubscriber {
  private readonly subscriptions = new Set<() => void>();

  constructor(
    private readonly app: Pick<AppContext, 'bus' | 'logger'>,
    private readonly source: string,
  ) {}

  /** Возвращает точечную отписку; после `close()` она ничего не делает. */
  on<D extends AnyEventDef>(def: D, handler: TracedHandler<D>): () => void {
    const unsubscribe = this.app.bus.subscribe(def, (envelope) =>
      this.deliver(envelope, () =>
        handler(envelope, Trace.fromEvent(envelope)),
      ),
    );
    const off = () => {
      if (this.subscriptions.delete(off)) unsubscribe();
    };
    this.subscriptions.add(off);
    return off;
  }

  /** Снимает все подписки экземпляра; после него можно подписывать снова. */
  close(): void {
    for (const off of [...this.subscriptions]) off();
  }

  // Синхронный бросок ловится до первого `await`: запись — сразу, а шина
  // всегда получает выполненный промис.
  private async deliver(
    envelope: EventEnvelope,
    run: () => Promise<void>,
  ): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.fail(envelope, error);
    }
  }

  private fail(envelope: EventEnvelope, error: unknown): void {
    const text = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    this.app.logger.error(
      this.source,
      `обработчик события ${envelope.name} упал: ${text}`,
      {
        event: envelope.name,
        eventId: envelope.eventId,
        correlationId: envelope.correlationId,
        error: text,
        ...(stack === undefined ? {} : { stack }),
      },
    );
  }
}
