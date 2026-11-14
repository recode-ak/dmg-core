import { afterEach, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Временный каталог теста во временном каталоге ОС; `using` удаляет его. */
export class TempDir {
  private constructor(readonly path: string) {}

  static create(prefix = 'dmg-'): TempDir {
    return new TempDir(mkdtempSync(join(tmpdir(), prefix)));
  }

  /** Путь внутри каталога из сегментов; файл не создаётся. */
  file(...segments: string[]): string {
    return join(this.path, ...segments);
  }

  /** Удаляет каталог вместе с содержимым. */
  dispose(): void {
    rmSync(this.path, { recursive: true, force: true });
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}

/**
 * Свой `TempDir` на каждый тест блока: создаётся в `beforeEach`, удаляется
 * в `afterEach`. Вызов вне теста — исключение.
 */
export function useTempDir(prefix?: string): () => TempDir {
  let dir: TempDir | undefined;
  beforeEach(() => {
    dir = TempDir.create(prefix);
  });
  afterEach(() => {
    dir?.dispose();
    dir = undefined;
  });
  return () => {
    if (dir === undefined)
      throw new Error('useTempDir: каталог есть только внутри теста');
    return dir;
  };
}
