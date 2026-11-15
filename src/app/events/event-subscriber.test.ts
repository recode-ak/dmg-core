import { describe, expect, it } from 'bun:test';
import { TaskEvents } from '#core/testing/example/todo/task/task.events';
import { MemoryBus, MemoryLogger } from '#core/testing/index';
import type { EventEnvelope } from './event-envelope';
import { EventSubscriber } from './event-subscriber';
import { InProcEventBus } from './in-proc-event-bus';

const created = TaskEvents.created.name;

const envelope = (
  name: string,
  eventId: string,
  payload: Record<string, unknown> = {},
): EventEnvelope => ({
  name,
  payload,
  eventId,
  occurredAt: 0,
  aggregateId: 'a-1',
  cause: { kind: 'request', requestId: 'r-1' },
  correlationId: 'c-1',
});

type ErrorRecord = {
  source: string;
  message: string;
  meta: Record<string, unknown> | undefined;
};

/** Логгер, который сохраняет `meta` записей `error` и сообщает о первой. */
class MetaLogger extends MemoryLogger {
  readonly errors: ErrorRecord[] = [];
  private signal: () => void = () => {};
  readonly logged = new Promise<void>((resolve) => {
    this.signal = resolve;
  });

  override error(
    source: string,
    message: string,
    meta?: Record<string, unknown>,
  ): void {
    super.error(source, message);
    this.errors.push({ source, message, meta });
    this.signal();
  }
}

function setup() {
  const logger = new MetaLogger();
  const bus = new InProcEventBus(logger);
  const subscriber = new EventSubscriber({ bus, logger }, 'ui');
  return { logger, bus, subscriber };
}

const FAILED = `обработчик события ${created} упал: boom`;
const META_KEYS = ['correlationId', 'error', 'event', 'eventId', 'stack'];

describe('EventSubscriber', () => {
  it('обработчик получает тот же конверт и след события', () => {
    const { bus, subscriber } = setup();
    const got: unknown[] = [];
    subscriber.on(TaskEvents.created, async (e, trace) => {
      got.push(e, trace);
    });
    const sent = envelope(created, 'e-1');
    bus.publish(sent);
    const [received, trace] = got as [unknown, { [k: string]: unknown }];
    expect(received).toBe(sent);
    expect(trace.cause).toEqual({ kind: 'event', eventId: 'e-1' });
    expect(trace.correlationId).toBe('c-1');
    expect(trace.channel).toBeUndefined();
  });

  it('доставка только по Def: другое событие не доходит', () => {
    const { bus, subscriber } = setup();
    const got: string[] = [];
    subscriber.on(TaskEvents.completed, async (e) => {
      got.push(e.eventId);
    });
    bus.publish(envelope(created, 'e-1'));
    expect(got).toEqual([]);
    bus.publish(envelope(TaskEvents.completed.name, 'e-2'));
    expect(got).toEqual(['e-2']);
  });

  it('отписка: после off() доставки нет, другая подписка работает', () => {
    const { bus, subscriber } = setup();
    const got: string[] = [];
    const off = subscriber.on(TaskEvents.created, async () => {
      got.push('off');
    });
    subscriber.on(TaskEvents.created, async () => {
      got.push('on');
    });
    off();
    bus.publish(envelope(created, 'e-1'));
    expect(got).toEqual(['on']);
  });

  it('отказ промиса: запись в logger.error со своим source, остальные получают конверт', async () => {
    const { logger, bus, subscriber } = setup();
    const got: string[] = [];
    subscriber.on(TaskEvents.created, async () => {
      throw new Error('boom');
    });
    subscriber.on(TaskEvents.created, async (e) => {
      got.push(e.eventId);
    });
    expect(() => bus.publish(envelope(created, 'e-1'))).not.toThrow();
    await logger.logged;
    expect(got).toEqual(['e-1']);
    expect(logger.errors).toHaveLength(1);
    const [record] = logger.errors;
    expect(record?.source).toBe('ui');
    expect(record?.message).toBe(FAILED);
    expect(Object.keys(record?.meta ?? {}).sort()).toEqual(META_KEYS);
    expect(record?.meta).toMatchObject({
      event: created,
      eventId: 'e-1',
      correlationId: 'c-1',
      error: 'boom',
    });
  });

  it('синхронное исключение: та же запись, остальные получают конверт', () => {
    const { logger, bus, subscriber } = setup();
    const got: string[] = [];
    subscriber.on(TaskEvents.created, (): Promise<void> => {
      throw new Error('boom');
    });
    subscriber.on(TaskEvents.created, async (e) => {
      got.push(e.eventId);
    });
    expect(() => bus.publish(envelope(created, 'e-1'))).not.toThrow();
    expect(got).toEqual(['e-1']);
    expect(logger.errors).toHaveLength(1);
    const [record] = logger.errors;
    expect(record?.source).toBe('ui');
    expect(record?.message).toBe(FAILED);
    expect(Object.keys(record?.meta ?? {}).sort()).toEqual(META_KEYS);
  });

  it('бросок не-Error: error — строкой, без stack', () => {
    const { logger, bus, subscriber } = setup();
    subscriber.on(TaskEvents.created, (): Promise<void> => {
      throw 'строка';
    });
    bus.publish(envelope(created, 'e-1'));
    const [record] = logger.errors;
    expect(record?.message).toBe(`обработчик события ${created} упал: строка`);
    expect(record?.meta).toEqual({
      event: created,
      eventId: 'e-1',
      correlationId: 'c-1',
      error: 'строка',
    });
  });

  it('на шине, которая сама сбой не ловит: отказ записан, необработанного нет', async () => {
    const logger = new MetaLogger();
    const bus = new MemoryBus();
    const subscriber = new EventSubscriber({ bus, logger }, 'ui');
    const unhandled: unknown[] = [];
    const listen = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', listen);
    try {
      subscriber.on(TaskEvents.created, async () => {
        throw new Error('boom');
      });
      bus.publish(envelope(created, 'e-1'));
      await logger.logged;
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      process.off('unhandledRejection', listen);
    }
    expect(logger.errors.map((e) => e.message)).toEqual([FAILED]);
    expect(unhandled).toEqual([]);
  });

  it('payload события в запись сбоя не попадает', () => {
    const { logger, bus, subscriber } = setup();
    subscriber.on(TaskEvents.created, (): Promise<void> => {
      throw new Error('boom');
    });
    bus.publish(envelope(created, 'e-1', { title: 'СЕКРЕТНОЕ-НАЗВАНИЕ' }));
    const [record] = logger.errors;
    expect(JSON.stringify(record)).not.toContain('СЕКРЕТНОЕ-НАЗВАНИЕ');
  });

  describe('close()', () => {
    it('снимает все подписки экземпляра, подписки другого не трогает', () => {
      const { logger, bus, subscriber } = setup();
      const other = new EventSubscriber({ bus, logger }, 'web');
      const got: string[] = [];
      subscriber.on(TaskEvents.created, async () => {
        got.push('ui-created');
      });
      subscriber.on(TaskEvents.completed, async () => {
        got.push('ui-completed');
      });
      other.on(TaskEvents.created, async () => {
        got.push('web-created');
      });
      subscriber.close();
      bus.publish(envelope(created, 'e-1'));
      bus.publish(envelope(TaskEvents.completed.name, 'e-2'));
      expect(got).toEqual(['web-created']);
    });

    it('после close() новая подписка работает', () => {
      const { bus, subscriber } = setup();
      const got: string[] = [];
      subscriber.on(TaskEvents.created, async () => {
        got.push('old');
      });
      subscriber.close();
      subscriber.on(TaskEvents.created, async (e) => {
        got.push(e.eventId);
      });
      bus.publish(envelope(created, 'e-1'));
      expect(got).toEqual(['e-1']);
    });

    it('точечная отписка после close() и повторный close() ничего не ломают', () => {
      const { bus, subscriber } = setup();
      const got: string[] = [];
      const off = subscriber.on(TaskEvents.created, async () => {
        got.push('first');
      });
      subscriber.close();
      subscriber.on(TaskEvents.created, async () => {
        got.push('second');
      });
      expect(() => off()).not.toThrow();
      bus.publish(envelope(created, 'e-1'));
      expect(got).toEqual(['second']);
      subscriber.close();
      expect(() => subscriber.close()).not.toThrow();
      bus.publish(envelope(created, 'e-2'));
      expect(got).toEqual(['second']);
    });
  });
});
