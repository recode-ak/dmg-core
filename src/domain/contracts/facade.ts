import type { SystemCaller } from '#core/kernel/caller/caller';
import type { Result } from '#core/kernel/result/result';
import type { Trace } from '#core/kernel/trace/trace';
import type { AnyModuleDef } from './module-def';
import type {
  AnyUseCaseDef,
  InputOf,
  OutputOf,
  SystemCallableUc,
  UseCaseErrorOf,
} from './use-case-def';

/** UC модуля M, которые может вызвать система: `'system'` в `callers`. */
export type SystemCallable<M extends AnyModuleDef> = SystemCallableUc<
  M['useCases'][number]
>;

/**
 * Фасад модуля M — граница для других модулей (D-42): вход в UC, доступные
 * системе, от `SystemCaller` потребителя; выход и ошибки — как у UC.
 * Реализация — `ModuleFacade`, сетевой клиент или `StubFacade`, вызывающий
 * код от неё не зависит. @see docs/guides/facade.md
 */
export interface Facade<M extends AnyModuleDef> {
  readonly def: M;
  handle<D extends AnyUseCaseDef>(
    def: D extends SystemCallable<M> ? D : never,
    input: InputOf<D>,
    caller: SystemCaller,
    trace: Trace,
  ): Promise<Result<OutputOf<D>, UseCaseErrorOf<D>>>;
}
