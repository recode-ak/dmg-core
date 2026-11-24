import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import {
  checkCovers,
  coversOf,
  exitCode,
  impactOf,
  lastCodeChangeAt,
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
  const verifiedAt = () => undefined;

  it('исходник не менялся после документа — тихо', () => {
    expect(
      checkCovers([doc(['src/app/uow.ts'])], exists, changedAt, verifiedAt),
    ).toEqual({
      missing: [],
      stale: [],
    });
  });

  it('исходник менялся позже документа — warn со списком документа', () => {
    const docs = [doc(['src/app/uow.ts', 'src/app/use-case/**'])];
    expect(checkCovers(docs, exists, changedAt, verifiedAt)).toEqual({
      missing: [],
      stale: [
        'docs/concepts/uc-path.md: src/app/use-case/** менялся позже документа',
      ],
    });
  });

  it('документ без истории (новый) — свежий', () => {
    const docs = [doc(['src/app/use-case/**'], 'docs/concepts/new.md')];
    expect(checkCovers(docs, exists, changedAt, verifiedAt).stale).toEqual([]);
  });

  it('путь из covers не найден — нарушение', () => {
    expect(
      checkCovers([doc(['src/app/gone.ts'])], exists, changedAt, verifiedAt),
    ).toEqual({
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
    expect(
      checkCovers([inline], exists, changedAt, verifiedAt).missing,
    ).toEqual([
      'skills/x/SKILL.md: covers — не разобран, нужен список строк «  - путь»',
    ]);
  });
});

describe('lastCodeChangeAt: время последней правки кода по git log -p', () => {
  const commit = (time: number, ...lines: string[]) =>
    [
      `@${time}`,
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,2 +1,2 @@',
      ...lines,
    ].join('\n');

  it('коммит только с комментариями пропускается — время предыдущего', () => {
    const log = [
      commit(30, '-/**', '- * Длинно.', '- */', '+/** Коротко. */'),
      commit(20, '-// старое', '+// новое', '+', '-  * строка'),
      commit(10, '-const a = 1;', '+const a = 2;'),
    ].join('\n');
    expect(lastCodeChangeAt(log)).toBe(10);
  });

  it('правка кода — время этого коммита', () => {
    const log = [
      commit(30, '+export const b = 1;'),
      commit(10, '+const a = 1;'),
    ].join('\n');
    expect(lastCodeChangeAt(log)).toBe(30);
  });

  it('код с комментарием в конце строки — правка кода', () => {
    expect(lastCodeChangeAt(commit(5, '+run(); // шаг'))).toBe(5);
  });

  it('код после однострочного JSDoc — правка кода', () => {
    expect(lastCodeChangeAt(commit(5, '+/** x */ const a = 1;'))).toBe(5);
  });

  it('только комментарии во всей истории — undefined', () => {
    expect(lastCodeChangeAt(commit(5, '+// x'))).toBeUndefined();
  });

  it('заголовки diff не считаются строками кода', () => {
    expect(lastCodeChangeAt(commit(7))).toBeUndefined();
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

describe('checkCovers: verified — документ сверен с кодом на коммите', () => {
  const time: Record<string, number> = {
    'docs/concepts/uc-path.md': 200,
    'src/app/use-case/**': 300,
  };
  const changedAt = (path: string) => time[path];
  const exists = (path: string) => path in time;
  const commits: Record<string, number> = { abc1234: 300, old5678: 250 };
  const verifiedAt = (sha: string) => commits[sha];
  const verified = (sha: string): DocFile => ({
    path: 'docs/concepts/uc-path.md',
    text: `---\ncovers:\n  - src/app/use-case/**\nverified: ${sha}\n---\n\n# Путь UC\n`,
  });

  it('verified не раньше правки кода — тихо', () => {
    expect(
      checkCovers([verified('abc1234')], exists, changedAt, verifiedAt),
    ).toEqual({ missing: [], stale: [] });
  });

  it('verified раньше правки кода — warn', () => {
    expect(
      checkCovers([verified('old5678')], exists, changedAt, verifiedAt).stale,
    ).toEqual([
      'docs/concepts/uc-path.md: src/app/use-case/** менялся позже документа',
    ]);
  });

  it('неизвестный коммит в verified — нарушение', () => {
    expect(
      checkCovers([verified('nope000')], exists, changedAt, verifiedAt).missing,
    ).toEqual(['docs/concepts/uc-path.md: verified — нет коммита nope000']);
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
  // Тест обходит реальную историю git пакета (`git log -p` на каждый шаблон
  // covers): время растёт с историей, поэтому свой таймаут.
  it('каждый путь covers находит файлы', () => {
    const { docs, exists, changedAt, verifiedAt } = readCovers(
      join(import.meta.dir, '..'),
    );
    expect(docs.map((d) => d.path)).toContain('docs/guides/facade.md');
    expect(checkCovers(docs, exists, changedAt, verifiedAt).missing).toEqual(
      [],
    );
  }, 30_000);

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
