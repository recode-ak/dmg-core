/**
 * Ошибка ввода или коллизия `dmg-core gen`: сообщение — пользователю, без
 * стека. Узнаётся по `name`, а не `instanceof`: вид поставщика бросает её из
 * своей копии пакета.
 */
export class GenError extends Error {
  /** `GenError` любой копии пакета — по `name` */
  static is(error: unknown): error is GenError {
    return error instanceof Error && error.name === 'GenError';
  }

  override name = 'GenError';
}
