import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { ResolvedImport, SourceImport } from './source-scan.types';

/** Суффиксы тестового кода: тесты, фикстуры, наборы клиентов, фейки портов. */
const TEST_FILE = /\.(test|fixture|test-kit|repo\.fake)\.ts$/;

const IMPORT =
  /(?:^|[\s;])(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\sfrom\s*)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * Чтение исходников для проверок по файлам: `.ts`-файлы каталога или всего
 * проекта, их импорты с разрешёнными путями и принадлежность пути каталогу
 * или его входу. Общий для проверок файлов модулей, слоёв и единиц
 * выноса.
 */
export class SourceScan {
  /** `.ts`-файлы каталога, относительные пути через `/`, по алфавиту. */
  files(base: string): string[] {
    if (!existsSync(base)) return [];
    return [...new Bun.Glob('**/*.ts').scanSync({ cwd: base })]
      .map((f) => f.split(sep).join('/'))
      .sort();
  }

  /**
   * `.ts`-файлы проекта, как `files`, без путей с сегментом `node_modules`
   * (D-107). Верхний `node_modules` не читается вовсе; скрытые каталоги и
   * ссылки на каталоги не обходятся, как в `Bun.Glob`.
   */
  projectFiles(root: string): string[] {
    if (!existsSync(root)) return [];
    return readdirSync(root, { withFileTypes: true })
      .flatMap((entry) => {
        const { name } = entry;
        if (name === 'node_modules' || name.startsWith('.')) return [];
        if (entry.isDirectory()) {
          return this.files(join(root, name)).map((f) => `${name}/${f}`);
        }
        return entry.isFile() && name.endsWith('.ts') ? [name] : [];
      })
      .filter((f) => !f.split('/').includes('node_modules'))
      .sort();
  }

  /**
   * Все импорты файла в порядке записи (D-108): неразрешимый пакет — с
   * `target: undefined`, а не пропущен. Относительный путь разрешается без
   * проверки файла и без расширения.
   */
  specifiers(file: string): SourceImport[] {
    const text = readFileSync(file, 'utf8');
    return [...text.matchAll(IMPORT)].flatMap((m) => {
      const spec = m[1] ?? m[2];
      if (spec === undefined) return [];
      return [{ spec, target: this.resolve(spec, dirname(file)) }];
    });
  }

  /** Импорты файла с абсолютной целью; неразрешимые пакеты пропускаются. */
  imports(file: string): ResolvedImport[] {
    return this.specifiers(file).flatMap(({ spec, target }) =>
      target === undefined ? [] : [{ spec, target }],
    );
  }

  inside(path: string, dir: string): boolean {
    return path === dir || path.startsWith(dir + sep);
  }

  /**
   * Путь — код проекта: внутри `project` и без сегмента `node_modules`
   * (сегмент — от `project`: сам проект может лежать в пакете).
   */
  inProject(path: string, project: string): boolean {
    return (
      this.inside(path, project) &&
      !relative(project, path).split(sep).includes('node_modules')
    );
  }

  /**
   * Цель импорта — вход каталога: `<dir>/<entry>.ts` или `<dir>/<entry>`;
   * для `index` — также сам `<dir>`.
   */
  isEntry(path: string, dir: string, entry: string): boolean {
    const bare = path.replace(/\.[jt]s$/, '');
    return bare === join(dir, entry) || (entry === 'index' && bare === dir);
  }

  /**
   * Файл — тестовый код (D-70): тест, фикстура, набор клиента, фейк порта,
   * файл каталога `tests/` или сам вход `<testing>.ts` модуля. `file` —
   * путь через `/`, как из `files()`.
   */
  isTest(file: string, testing: string): boolean {
    const parts = file.split('/');
    return (
      TEST_FILE.test(file) ||
      parts.at(-1) === `${testing}.ts` ||
      parts.slice(0, -1).includes('tests')
    );
  }

  private resolve(spec: string, from: string): string | undefined {
    if (spec.startsWith('.')) return resolve(from, spec);
    try {
      return Bun.resolveSync(spec, from);
    } catch {
      return undefined;
    }
  }
}
