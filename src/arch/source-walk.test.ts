import { describe, expect, test } from 'bun:test';
import { useTempDir } from '#core/testing/index';
import { SourceWalk } from './source-walk';

describe('SourceWalk.paths', () => {
  const tmp = useTempDir('source-walk-');
  const put = (path: string) => Bun.write(tmp().file(path), 'x');
  const paths = () => new SourceWalk(tmp().path).paths().sort();

  test('все файлы от корня: пути через «/», каталоги не в списке', async () => {
    await put('a.ts');
    await put('src/user/b.ts');
    await put('docs/c.md');
    expect(paths()).toEqual(['a.ts', 'docs/c.md', 'src/user/b.ts']);
  });

  test('node_modules, .git и data в корне не обходятся', async () => {
    await put('pkg/a.ts');
    await put('node_modules/x/index.ts');
    await put('.git/HEAD');
    await put('data/users/u.json');
    expect(paths()).toEqual(['pkg/a.ts']);
  });

  test('node_modules и .git на любой глубине не обходятся', async () => {
    await put('pkg/a.ts');
    await put('pkg/node_modules/x/index.ts');
    await put('pkg/sub/.git/HEAD');
    expect(paths()).toEqual(['pkg/a.ts']);
  });

  test('dist на любой глубине не обходится', async () => {
    await put('dist/index.js');
    await put('pkg/dist/index.js');
    await put('pkg/a.ts');
    expect(paths()).toEqual(['pkg/a.ts']);
  });

  test('data не в корне обходится', async () => {
    await put('data/users/u.json');
    await put('pkg/data/seed.ts');
    expect(paths()).toEqual(['pkg/data/seed.ts']);
  });
});
