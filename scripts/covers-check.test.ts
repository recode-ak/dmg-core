import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import {
  checkCovers,
  coversOf,
  exitCode,
  impactOf,
  readCovers,
} from './covers-check';
import { type DocFile, readDocs } from './docs-check';

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

  it('covers: в неразобранной форме — нарушение, а не тишина', () => {
    const inline: DocFile = {
      path: 'skills/x/SKILL.md',
      text: '---\ncovers: [src/app/uow.ts]\n---\n# X\n',
    };
    expect(checkCovers([inline], exists, changedAt).missing).toEqual([
      'skills/x/SKILL.md: covers — не разобран, нужен список строк «  - путь»',
    ]);
  });
});

describe('exitCode: код выхода docs:covers', () => {
  const stale = { missing: [], stale: ['d: s менялся позже документа'] };
  const missing = { missing: ['d: covers — нет файлов s'], stale: [] };

  it('отставание — 0 в check, 1 со --strict', () => {
    expect(exitCode(stale, false)).toBe(0);
    expect(exitCode(stale, true)).toBe(1);
  });

  it('нет файлов covers — 1 всегда; чисто — 0', () => {
    expect(exitCode(missing, false)).toBe(1);
    expect(exitCode({ missing: [], stale: [] }, true)).toBe(0);
  });
});

describe('impactOf: документы по изменённым путям', () => {
  const docs = [
    doc(['src/app/uow.ts', 'src/app/use-case/**']),
    doc(['src/domain/aggregate/**'], 'docs/guides/aggregate.md'),
  ];

  it('путь совпал с covers (файл или шаблон) — документ в списке', () => {
    expect(impactOf(docs, ['src/app/use-case/from-def.ts'])).toEqual([
      'docs/concepts/uc-path.md',
    ]);
    expect(
      impactOf(docs, ['src/app/uow.ts', 'src/domain/aggregate/ar.ts']),
    ).toEqual(['docs/concepts/uc-path.md', 'docs/guides/aggregate.md']);
  });

  it('не совпал — пусто', () => {
    expect(impactOf(docs, ['src/kernel/result.ts', 'docs/index.md'])).toEqual(
      [],
    );
  });

  it('путь через node_modules или репо пакета и каталог — совпадают', () => {
    expect(impactOf(docs, ['node_modules/dmg-core/src/app/uow.ts'])).toEqual([
      'docs/concepts/uc-path.md',
    ]);
    expect(impactOf(docs, ['/home/u/dmg-core/src/domain/'])).toEqual([
      'docs/guides/aggregate.md',
    ]);
  });
});

describe('covers пакета (контракт)', () => {
  it('каждый путь covers находит файлы', () => {
    const { docs, exists, changedAt } = readCovers(join(import.meta.dir, '..'));
    expect(docs.map((d) => d.path)).toContain('docs/guides/facade.md');
    expect(checkCovers(docs, exists, changedAt).missing).toEqual([]);
  });

  it('у каждого гайда и concept, кроме index.md и шаблонов _*, есть covers', () => {
    const { files } = readDocs(join(import.meta.dir, '..'));
    const without = files
      .filter((f) =>
        /^docs\/(?:guides|concepts)\/(?!index\.md$|_)/.test(f.path),
      )
      .filter((f) => coversOf(f.text).length === 0)
      .map((f) => f.path);
    expect(without).toEqual([]);
  });
});
