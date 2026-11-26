import { realpath, stat } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { ProjectConfig } from '../gen/project-config';
import type { Finding } from './delivery.types';

/**
 * Ссылки ролей на знания проекта (`roles.refs`): блок «Знания проекта» для
 * копии роли и проверка, что файлы по ссылкам есть.
 * @see src/cli/role-refs.test.ts
 */
export class RoleRefs {
  constructor(
    private readonly refs: ReadonlyMap<string, readonly string[]> = new Map(),
  ) {}

  /** Текст блока для роли; у роли без ссылок — пустая строка */
  block(role: string): string {
    const paths = this.refs.get(role);
    if (!paths?.length) return '';
    return [
      '## Знания проекта',
      '',
      'Пути — от корня проекта; прочитай до начала работы:',
      '',
      ...paths.map((path) => `- \`${path}\``),
    ].join('\n');
  }

  /**
   * Ссылки, по которым нет файла проекта в root, в порядке конфига. Содержимое
   * не читается; симлинк допустим, пока цель внутри корня: цель за корнем на
   * другой машине не воспроизводится.
   */
  async broken(root: string): Promise<Finding[]> {
    const found: Finding[] = [];
    if (this.refs.size === 0) return found;
    const base = await realpath(root);
    for (const [role, paths] of this.refs) {
      for (const path of paths) {
        const problem = await RoleRefs.problem(base, path);
        if (problem) {
          found.push({
            path,
            message: `битая ссылка roles.refs «${role}» (DOC-10) — ${problem}`,
          });
        }
      }
    }
    return found;
  }

  /** Что не так с файлом по ссылке; base — `realpath` корня */
  private static async problem(
    base: string,
    path: string,
  ): Promise<string | undefined> {
    const missing = `нет файла; создай его или убери путь из ${ProjectConfig.file}`;
    const real = await realpath(join(base, path)).catch(() => undefined);
    if (real === undefined) return missing;
    if (!real.startsWith(`${base}${sep}`)) {
      return 'ведёт за корень проекта; укажи файл внутри проекта';
    }
    // Файл мог исчезнуть или закрыться правами после realpath.
    const info = await stat(real).catch(() => undefined);
    if (info === undefined) return missing;
    if (info.isDirectory()) return 'каталог; укажи файл в нём (index.md)';
    return undefined;
  }
}
