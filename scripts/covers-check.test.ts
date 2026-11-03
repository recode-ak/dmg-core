import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { checkCovers, coversOf, readCovers } from './covers-check';
import type { DocFile } from './docs-check';

const doc = (covers: string[], path = 'docs/concepts/uc-path.md'): DocFile => ({
  path,
  text: `---\ncovers:\n${covers.map((c) => `  - ${c}`).join('\n')}\n---\n\n# Путь UC\n`,
});

describe('coversOf: front-matter', () => {
  it('список путей и шаблонов из covers:', () => {
    expect(
      coversOf(doc(['src/app/uow.ts', 'src/app/use-case/**']).text),
    ).toEqual(['src/app/uow.ts', 'src/app/use-case/**']);
  });

  it('без front-matter — пусто', () => {
    expect(coversOf('# Гайд\n\n---\ncovers:\n  - src/x.ts\n---\n')).toEqual([]);
  });
});

describe('checkCovers: исходник позже документа', () => {
  const time: Record<string, number> = {
    'docs/concepts/uc-path.md': 200,
    'src/app/uow.ts': 100,
    'src/app/use-case/**': 300,
  };
  const changedAt = (path: string) => time[path];
  const exists = (path: string) => path in time;

  it('исходник не менялся после документа — тихо', () => {
    expect(checkCovers([doc(['src/app/uow.ts'])], exists, changedAt)).toEqual({
      missing: [],
      stale: [],
    });
  });

  it('исходник менялся позже документа — warn со списком документа', () => {
    const docs = [doc(['src/app/uow.ts', 'src/app/use-case/**'])];
    expect(checkCovers(docs, exists, changedAt)).toEqual({
      missing: [],
      stale: [
        'docs/concepts/uc-path.md: src/app/use-case/** менялся позже документа',
      ],
    });
  });

  it('документ без истории (новый) — свежий', () => {
    const docs = [doc(['src/app/use-case/**'], 'docs/concepts/new.md')];
    expect(checkCovers(docs, exists, changedAt).stale).toEqual([]);
  });

  it('путь из covers не найден — нарушение', () => {
    expect(checkCovers([doc(['src/app/gone.ts'])], exists, changedAt)).toEqual({
      missing: [
        'docs/concepts/uc-path.md: covers — нет файлов src/app/gone.ts',
      ],
      stale: [],
    });
  });
});

describe('covers пакета (контракт)', () => {
  it('каждый путь covers находит файлы', () => {
    const { docs, exists, changedAt } = readCovers(join(import.meta.dir, '..'));
    expect(docs.map((d) => d.path)).toContain('docs/guides/facade.md');
    expect(checkCovers(docs, exists, changedAt).missing).toEqual([]);
  });
});
