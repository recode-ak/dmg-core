import { join } from 'node:path';

/**
 * Файлы под корнем пакета или проекта по шаблону `Bun.Glob`: пути от каталога,
 * по алфавиту, со скрытыми. Нет каталога — пусто: нечего нести или ещё
 * ничего не доставлено; прочие ошибки чтения — дальше.
 */
export class DirScan {
  constructor(private readonly root: string) {}

  async paths(dir: string, pattern: string): Promise<string[]> {
    const paths: string[] = [];
    const glob = new Bun.Glob(pattern);
    try {
      for await (const path of glob.scan({
        cwd: join(this.root, dir),
        dot: true,
      })) {
        paths.push(path);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    return paths.sort();
  }
}
