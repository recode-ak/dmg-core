import type { AnyUseCaseDef, InputOf } from './use-case-def.types';

declare const def: unique symbol;

/**
 * Расширение команды без смены протокола (reference/transport.md §2). Ожидаемая
 * версия агрегата сюда не входит — это поле входа UC (D-57).
 */
export type CommandMeta = {
  /**
   * Одно намерение клиента: клиент создаёт его один раз и повторяет при
   * ретраях — это и след, и ключ идемпотентности command UC (reference/transport.md §2).
   */
  readonly requestId?: string;
};

/**
 * Команда UC — простые данные (D-49): `uc` — имя Def, модуль адресует
 * транспорт. `D` фантомный: только тип, в данных его нет; по нему клиент
 * выводит вход, выход и ошибки.
 */
export type Command<D extends AnyUseCaseDef = AnyUseCaseDef> = {
  readonly uc: D['name'];
  readonly input: InputOf<D>;
  readonly meta?: CommandMeta;
  readonly [def]?: D;
};

/** Def, из которого собрана команда. */
export type DefOfCommand<C> = C extends Command<infer D> ? D : never;
