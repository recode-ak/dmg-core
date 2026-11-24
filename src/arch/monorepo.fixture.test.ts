import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Monorepo } from './monorepo.fixture';

// Сценарий — в своём каталоге и фикстура целиком до `install()`: кэш
// резолвера Bun не забывает прошлых разрешений.
let repo: Monorepo;

beforeEach(() => {
  repo = Monorepo.create();
});

afterEach(() => {
  repo.dispose();
});

describe('Monorepo: внешний пакет', () => {
  it('vendor с exports: подпуть из exports разрешается, мимо — нет', () => {
    repo
      .vendor(
        'ext-x',
        {
          'index.ts': 'export {};\n',
          'sub.ts': 'export {};\n',
          'hidden.ts': 'export {};\n',
        },
        { '.': './index.ts', './sub': './sub.ts' },
      )
      .root({ name: 'proj', dependencies: ['ext-x'] });
    repo.install();
    expect(Bun.resolveSync('ext-x', repo.proj)).toEndWith('/index.ts');
    expect(Bun.resolveSync('ext-x/sub', repo.proj)).toEndWith('/sub.ts');
    expect(() => Bun.resolveSync('ext-x/hidden', repo.proj)).toThrow();
  });
});
