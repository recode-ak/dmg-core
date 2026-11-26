import type { CliResult } from './dmg-core-cli';

/**
 * Итог `docs`: `messages` — как у остальных команд (ok — stdout, иначе
 * stderr); `out` — строки stdout при любом `ok`, по строке на элемент.
 */
export type DocsResult = CliResult & {
  readonly usage?: true;
  readonly out?: readonly string[];
};
