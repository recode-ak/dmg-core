import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Каталоги, которые не обходятся на любой глубине: чужой код, история, сборка. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist']);
/** Каталоги, которые не обходятся только в корне: данные приложения. */
const ROOT_SKIP_DIRS = new Set(['data']);

/**
 * Обход файлов репо: пути от корня через `/`, без `node_modules`, `.git`,
 * `dist` на любой глубине и `data` в корне. Набор пропусков — одно место
 * для учёта долга и проверки ID документов.
 * @see src/arch/source-walk.test.ts
 */
export class SourceWalk {
  constructor(private readonly root: string) {}

  /** Пути файлов от корня; порядок не гарантируется */
  paths(): string[] {
    return this.walk('');
  }

  private walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(join(this.root, dir), {
      withFileTypes: true,
    })) {
      const path = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (!dir && ROOT_SKIP_DIRS.has(entry.name)) continue;
        out.push(...this.walk(path));
      } else if (entry.isFile()) out.push(path);
    }
    return out;
  }
}
