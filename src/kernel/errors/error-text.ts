// Текст отказа по умолчанию (D-99): из значения ошибки, без Def и графа.
// Правило выбирается таблицей по виду: новый вид без правила не скомпилируется.
// Payload в текст не идёт, кроме `issues` валидации и `denyMessage` доступа.
import * as v from 'valibot';
import { CoreErrors, Issues } from './core-errors';
import type { DomainError, ErrorKind } from './error';
import type {
  ErrorTextField,
  ErrorTextParts,
  ErrorTextRule,
} from './error-text.types';

const DenyMessage = v.object({
  denyMessage: v.pipe(v.string(), v.minLength(1)),
});

/** Текст отказа: главная строка и проблемы полей (только у валидации). */
export class ErrorText {
  private static readonly RULES: Record<ErrorKind, ErrorTextRule> = {
    validation: (error) => ({
      summary: error.label,
      fields: v.is(Issues, error.payload) ? error.payload.issues : [],
    }),
    unauthorized: (error) => ErrorText.labelOnly(error),
    access: (error) => ({
      summary: v.is(DenyMessage, error.payload)
        ? error.payload.denyMessage
        : error.label,
      fields: [],
    }),
    not_found: (error) => ErrorText.labelOnly(error),
    conflict: (error) => ErrorText.labelOnly(error),
    internal: (error) => ErrorText.labelOnly(error),
  };

  private constructor(
    readonly summary: string,
    readonly fields: readonly ErrorTextField[],
  ) {}

  /** Пустой `label` или вид вне `ERROR_KINDS` — текст `SERVER_INTERNAL`. */
  static of(error: DomainError): ErrorText {
    const known = Object.hasOwn(ErrorText.RULES, error.kind);
    const { summary, fields } =
      known && error.label
        ? ErrorText.RULES[error.kind](error)
        : ErrorText.labelOnly(CoreErrors.SERVER_INTERNAL.make());
    return new ErrorText(summary, fields);
  }

  /** С полями — `summary:` и по строке на поле; пустой `path` не пишется. */
  toString(): string {
    if (this.fields.length === 0) return this.summary;
    const lines = this.fields.map(({ path, message }) =>
      path ? `- ${path}: ${message}` : `- ${message}`,
    );
    return [`${this.summary}:`, ...lines].join('\n');
  }

  private static labelOnly(error: DomainError): ErrorTextParts {
    return { summary: error.label, fields: [] };
  }
}
