import type { AnyEventDef } from '#core/domain/events/event-def';
import type { Trace } from '#core/kernel/trace/trace';
import type { EnvelopeOf } from './event-envelope';

/** Обработчик внешней подписки: конверт события и след, порождённый им. */
export type TracedHandler<D extends AnyEventDef> = (
  envelope: EnvelopeOf<D>,
  trace: Trace,
) => Promise<void>;
