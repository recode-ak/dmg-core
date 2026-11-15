import type { ViolationHandler } from './declared-set.types';

export type { ViolationHandler } from './declared-set.types';

/**
 * Объявленное множество (D-93): сверка элемента с тем, что заявил
 * контракт, по идентичности (`Set`), и общий исход нарушения — обработчик
 * или `Error`. Без списка (`undefined`) объявлено всё.
 */
export class DeclaredSet<T> {
  private readonly items: ReadonlySet<T> | undefined;

  constructor(
    items: readonly T[] | undefined,
    private readonly onViolation?: ViolationHandler,
  ) {
    this.items = items === undefined ? undefined : new Set(items);
  }

  /** `items` не заданы — объявлено всё. */
  has(item: T): boolean {
    return this.items === undefined || this.items.has(item);
  }

  /** Не объявлен — нарушение с текстом `message`. */
  assert(item: T, message: string): void {
    if (!this.has(item)) this.violate(message);
  }

  /** Обработчик, иначе `throw new Error(message)`. */
  violate(message: string): void {
    if (this.onViolation === undefined) throw new Error(message);
    this.onViolation(message);
  }
}
