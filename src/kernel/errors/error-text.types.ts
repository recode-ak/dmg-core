import type { DomainError } from './error';

/** Проблема одного поля во входе операции: путь к полю и описание. */
export type ErrorTextField = {
  readonly path: string;
  readonly message: string;
};

/** Части текста отказа, которые правило вида берёт из ошибки. */
export type ErrorTextParts = {
  readonly summary: string;
  readonly fields: readonly ErrorTextField[];
};

/** Правило текста для одного вида ошибки. */
export type ErrorTextRule = (error: DomainError) => ErrorTextParts;
