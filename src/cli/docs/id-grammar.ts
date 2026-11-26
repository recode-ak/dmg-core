import type { IdMention } from './docs.types';

/** Форма ID аргумента `show`: префикс из частей `[A-Z][A-Z0-9]*` через `-`, `-`, цифры */
const ID_RE = /^([A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*)-(\d+)$/;

/**
 * Грамматика ID объявленных серий: префикс, `-`, цифры. Слева и справа от ID
 * не буква, не цифра, не дефис; при перекрытии префиксов — самый длинный.
 * Номер — число: `D-01` и `D-1` — один номер.
 * @see src/cli/docs/id-grammar.test.ts
 */
export class IdGrammar {
  private readonly pattern?: RegExp;

  constructor(prefixes: readonly string[]) {
    // Длинные префиксы раньше: в одной позиции чередование берёт первый подходящий.
    const sorted = [...new Set(prefixes)].sort((a, b) => b.length - a.length);
    if (sorted.length === 0) return;
    this.pattern = new RegExp(
      `(?<![\\p{L}\\p{N}-])(${sorted.join('|')})-(\\d+)(?![\\p{L}\\p{N}-])`,
      'gu',
    );
  }

  /** Форма ID для аргументов `show`: префикс (из букв A–Z, цифр и дефисов), `-`, цифры */
  static isId(arg: string): boolean {
    return IdGrammar.parse(arg) !== undefined;
  }

  /** Префикс и номер ID в форме аргумента `show`; не ID — undefined */
  static parse(
    arg: string,
  ): { readonly prefix: string; readonly number: number } | undefined {
    const match = ID_RE.exec(arg);
    if (!match) return undefined;
    return { prefix: match[1] ?? '', number: Number(match[2]) };
  }

  /** Упоминания ID объявленных префиксов в тексте, в порядке текста */
  find(text: string): IdMention[] {
    if (!this.pattern) return [];
    return [...text.matchAll(this.pattern)].map((match) => ({
      id: match[0],
      prefix: match[1] ?? '',
      number: Number(match[2]),
      index: match.index,
    }));
  }
}
