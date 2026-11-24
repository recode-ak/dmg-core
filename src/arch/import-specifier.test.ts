import { describe, expect, it } from 'bun:test';
import { ImportSpecifier } from './import-specifier';

// Классификация спецификатора для ARC-14/15 (D-108): путь, встроенный модуль
// рантайма (`isBuiltin` Bun, в нём и `ws`, `undici`), `imports` своего пакета
// (`#…`), пакет. Собственное имя единицы классу неизвестно — пакет.
const classify = (specs: readonly string[], field: 'kind' | 'packageName') =>
  Object.fromEntries(
    specs.map((spec) => [spec, new ImportSpecifier(spec)[field]]),
  );

describe('ImportSpecifier', () => {
  it('ARC-14: kind — path, runtime, subpath, package', () => {
    expect(
      classify(
        [
          './x',
          '../x/y',
          '.',
          '..',
          '/abs/x',
          'node:fs',
          'node:fs/promises',
          'fs',
          'fs/promises',
          'bun',
          'bun:test',
          'ws',
          'undici',
          '#internal',
          'ext-a',
          'ext-a/sub',
          '@v/scoped',
          '@v/scoped/sub',
        ],
        'kind',
      ),
    ).toEqual({
      './x': 'path',
      '../x/y': 'path',
      '.': 'path',
      '..': 'path',
      '/abs/x': 'path',
      'node:fs': 'runtime',
      'node:fs/promises': 'runtime',
      fs: 'runtime',
      'fs/promises': 'runtime',
      bun: 'runtime',
      'bun:test': 'runtime',
      ws: 'runtime',
      undici: 'runtime',
      '#internal': 'subpath',
      'ext-a': 'package',
      'ext-a/sub': 'package',
      '@v/scoped': 'package',
      '@v/scoped/sub': 'package',
    });
  });

  it('ARC-14: packageName — имя без подпути, у scoped — два сегмента; не у пакета — нет', () => {
    expect(
      classify(
        [
          'ext-a',
          'ext-a/sub/deep',
          '@v/scoped',
          '@v/scoped/sub/deep',
          './x',
          'node:fs',
          '#internal',
        ],
        'packageName',
      ),
    ).toEqual({
      'ext-a': 'ext-a',
      'ext-a/sub/deep': 'ext-a',
      '@v/scoped': '@v/scoped',
      '@v/scoped/sub/deep': '@v/scoped',
      './x': undefined,
      'node:fs': undefined,
      '#internal': undefined,
    });
  });
});
