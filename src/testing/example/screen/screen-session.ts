import {
  type ApiApp,
  type AppContext,
  DeclaredSet,
  EventSubscriber,
  type Trace,
  type TracedHandler,
} from '#core/app/index';
import {
  type AnyEventDef,
  type AnyModuleDef,
  type AnyUseCaseDef,
  type Caller,
  type Identified,
  type InputOf,
  type OutputOf,
  type Result,
  UseCaseDef,
  type UseCaseErrorOf,
} from '#core/index';
import type { AnyScreenDef } from './screen-def.types';

/**
 * Сессия экрана: `EventSubscriber` плюс `DeclaredSet` — слушает и вызывает
 * только объявленное в манифесте. Вызов идёт через `api.dispatch` (ARC-08).
 */
export class ScreenSession<U extends Identified> {
  private readonly subscriber: EventSubscriber;
  private readonly events: DeclaredSet<AnyEventDef>;
  private readonly useCases: DeclaredSet<AnyUseCaseDef>;

  constructor(
    private readonly screen: AnyScreenDef,
    context: Pick<AppContext, 'bus' | 'logger'>,
    private readonly api: ApiApp<U>,
  ) {
    this.subscriber = new EventSubscriber(context, `screen:${screen.name}`);
    this.events = new DeclaredSet(screen.listens);
    this.useCases = new DeclaredSet(screen.uses);
  }

  on<D extends AnyEventDef>(def: D, handler: TracedHandler<D>): () => void {
    this.events.assert(
      def,
      `экран ${this.screen.name} не объявил событие ${def.name}`,
    );
    return this.subscriber.on(def, handler);
  }

  // Не `async`: отказ должен быть синхронным броском до вызова.
  dispatch<
    M extends AnyModuleDef,
    D extends M['useCases'][number] & AnyUseCaseDef,
  >(
    module: M,
    def: D,
    input: InputOf<D>,
    caller: Caller<U>,
    trace: Trace,
  ): Promise<Result<OutputOf<D>, UseCaseErrorOf<D>>> {
    this.useCases.assert(
      def,
      `экран ${this.screen.name} не объявил UC ${def.name}`,
    );
    return this.api.dispatch(
      module,
      UseCaseDef.commandOf(def, input),
      caller,
      trace,
    );
  }

  close(): void {
    this.subscriber.close();
  }
}
