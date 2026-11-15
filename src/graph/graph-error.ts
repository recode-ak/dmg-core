import type { GraphErrorCode } from './graph-error.types';

/** Ошибка сборки или чтения графа (D-92): исключение с кодом, не `Result`. */
export class GraphError extends Error {
  constructor(
    readonly code: GraphErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'GraphError';
  }

  /**
   * Выполняет `action`; `GraphError` из него дополняет местом сбоя — элементом
   * и поставщиком, которых не знает бросивший (`GraphId`, `KindRegistry`).
   * Исходная ошибка остаётся в `cause`.
   */
  static at<T>(place: string, action: () => T): T {
    try {
      return action();
    } catch (error) {
      if (!(error instanceof GraphError)) throw error;
      throw new GraphError(error.code, `${place}: ${error.message}`, {
        cause: error,
      });
    }
  }
}
