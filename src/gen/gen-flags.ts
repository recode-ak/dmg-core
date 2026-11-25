import { GenError } from './gen-error';

/**
 * Общие флаги `dmg-core gen` — у своих видов и видов поставщиков один разбор:
 * `--write`, `--dry-run` (побеждает последний), `--adopt`. Своих опций у видов
 * нет: прочий аргумент на `--` — `GenError` с подсказкой usage.
 */
export class GenFlags {
  static parse(argv: readonly string[], usage: string): GenFlags {
    const positional: string[] = [];
    let write = false;
    let adopt = false;
    for (const arg of argv) {
      if (!arg.startsWith('--')) positional.push(arg);
      else if (arg === '--write') write = true;
      else if (arg === '--dry-run') write = false;
      else if (arg === '--adopt') adopt = true;
      else throw new GenError(`Неизвестная опция ${arg}\n${usage}`);
    }
    return new GenFlags(positional, write, adopt);
  }

  private constructor(
    /** Аргументы без флагов, в порядке ввода; первый — вид */
    readonly positional: readonly string[],
    readonly write: boolean,
    /** Режим перевода legacy-модуля: существующие точки входа не перезаписываются */
    readonly adopt: boolean,
  ) {}
}
