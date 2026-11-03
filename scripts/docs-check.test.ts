import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { checkDocs, checkSee, type DocFile, readDocs } from './docs-check';

const RULES = new Set(['DOM-02', 'API-01']);
const EXISTING = new Set([
  'docs/guides/aggregate.md',
  'docs/rules.md',
  'src/testing/example/todo/task/task.ar.ts',
]);
const exists = (path: string) => EXISTING.has(path);

const doc = (text: string, path = 'docs/guides/aggregate.md'): DocFile => ({
  path,
  text,
});

describe('checkDocs: ссылки и ID правил', () => {
  it('живые ссылки и ID правил — без нарушений', () => {
    const files = [
      doc(
        '[Ar](../../src/testing/example/todo/task/task.ar.ts) DOM-02\n' +
          '[rules](../rules.md#dom) [сайт](https://example.com) [тут](#1-когда)\n' +
          '## 1. Когда',
      ),
    ];
    expect(checkDocs(files, exists, RULES)).toEqual([]);
  });

  it('битая ссылка на файл — нарушение с путём', () => {
    const files = [doc('[Ar](../../src/testing/example/todo/a-root.ts)')];
    expect(checkDocs(files, exists, RULES)).toEqual([
      'docs/guides/aggregate.md: ссылка ведёт в несуществующий файл ../../src/testing/example/todo/a-root.ts',
    ]);
  });

  it('ссылка за пределы пакета — нарушение, даже если файл есть', () => {
    const files = [doc('[wish](../../../domain/src/wish.ts)')];
    expect(checkDocs(files, () => true, RULES)).toEqual([
      'docs/guides/aggregate.md: ссылка выходит за пределы пакета ../../../domain/src/wish.ts',
    ]);
  });

  it('неизвестный ID правила — нарушение', () => {
    const files = [doc('Проверь DOM-02 и DOM-99.')];
    expect(checkDocs(files, exists, RULES)).toEqual([
      'docs/guides/aggregate.md: правило DOM-99 нет в docs/rules.md',
    ]);
  });
});

describe('checkDocs: якоря', () => {
  const rules = doc(
    '# Правила\n\n## CODE — код\n\n## Карта линтера\n',
    'docs/rules.md',
  );

  it('якорь на заголовок другого файла и своего — без нарушений', () => {
    const files = [
      rules,
      doc('[код](../rules.md#code--код) [карта](#шаги)\n\n## Шаги\n'),
    ];
    expect(checkDocs(files, exists, RULES)).toEqual([]);
  });

  it('якорь без заголовка — битая ссылка', () => {
    const files = [rules, doc('[карта](../rules.md#карта)')];
    expect(checkDocs(files, exists, RULES)).toEqual([
      'docs/guides/aggregate.md: битый якорь ../rules.md#карта',
    ]);
  });

  it('заголовок внутри блока кода — не якорь', () => {
    const files = [doc('[x](#шаги)\n\n```md\n## Шаги\n```\n')];
    expect(checkDocs(files, exists, RULES)).toEqual([
      'docs/guides/aggregate.md: битый якорь #шаги',
    ]);
  });
});

describe('checkDocs: направление ссылок', () => {
  const all = () => true;
  const at = (path: string, ...targets: string[]) =>
    doc(targets.map((t) => `[x](${t})`).join(' '), path);

  it('concepts → guides, reference, decisions, образцы — без нарушений', () => {
    const files = [
      at(
        'docs/concepts/uc-path.md',
        '../guides/use-case.md',
        '../reference/rules.md',
        '../decisions.md',
        './layers.md',
        '../../src/testing/example/todo/task/task.ar.ts',
      ),
    ];
    expect(checkDocs(files, all, RULES)).toEqual([]);
  });

  it('guides → decisions — против направления', () => {
    const files = [at('docs/guides/facade.md', '../decisions.md')];
    expect(checkDocs(files, all, RULES)).toEqual([
      'docs/guides/facade.md: ссылка против направления (guides → decisions) ../decisions.md',
    ]);
  });

  it('reference → concepts и guides — против направления; → reference, decisions — можно', () => {
    const files = [
      at(
        'docs/reference/rules.md',
        './naming.md',
        '../decisions.md',
        '../concepts/uc-path.md',
        '../guides/use-case.md',
      ),
    ];
    expect(checkDocs(files, all, RULES)).toEqual([
      'docs/reference/rules.md: ссылка против направления (reference → concepts) ../concepts/uc-path.md',
      'docs/reference/rules.md: ссылка против направления (reference → guides) ../guides/use-case.md',
    ]);
  });

  it('документ → исходник платформы (не образец) — против направления', () => {
    const files = [
      at('docs/guides/facade.md', '../../src/app/facade/module-facade.ts'),
    ];
    expect(checkDocs(files, all, RULES)).toEqual([
      'docs/guides/facade.md: ссылка против направления (guides → src) ../../src/app/facade/module-facade.ts',
    ]);
  });

  it('смешанные документы в корне docs/, llms.txt, skills — не ограничены', () => {
    const files = [
      at('docs/transport.md', './decisions.md', '../src/app/index.ts'),
      at('llms.txt', 'docs/concepts/uc-path.md', 'src/index.ts'),
      at('skills/dmg-architecture/SKILL.md', '../../docs/decisions.md'),
    ];
    expect(checkDocs(files, all, RULES)).toEqual([]);
  });
});

describe('checkSee: @see в JSDoc', () => {
  const docs = [doc('# Путь UC\n\n## Commit\n', 'docs/concepts/uc-path.md')];
  const src = (text: string): DocFile => ({ path: 'src/app/uow.ts', text });
  const known = new Set(['docs/concepts/uc-path.md', 'src/app/uow.test.ts']);
  const has = (path: string) => known.has(path);

  it('путь от корня пакета на документ, якорь и тест — без нарушений', () => {
    const files = [
      src(
        '/**\n * Фиксирует.\n * @see docs/concepts/uc-path.md#commit\n * @see src/app/uow.test.ts\n */',
      ),
    ];
    expect(checkSee(files, docs, has)).toEqual([]);
  });

  it('@see на символ — не путь, не проверяется', () => {
    expect(checkSee([src('/** @see UnitOfWork */')], docs, has)).toEqual([]);
  });

  it('несуществующий файл и битый якорь — нарушения', () => {
    const files = [
      src(
        '/**\n * @see docs/concepts/uow.md\n * @see docs/concepts/uc-path.md#сбои\n */',
      ),
    ];
    expect(checkSee(files, docs, has)).toEqual([
      'src/app/uow.ts: @see ведёт в несуществующий файл docs/concepts/uow.md',
      'src/app/uow.ts: @see — битый якорь docs/concepts/uc-path.md#сбои',
    ]);
  });

  it('пунктуация после пути — не часть пути', () => {
    const files = [src('/** См. @see docs/concepts/uow.md. */')];
    expect(checkSee(files, docs, has)).toEqual([
      'src/app/uow.ts: @see ведёт в несуществующий файл docs/concepts/uow.md',
    ]);
  });

  it('пустой якорь и «%» в якоре — без исключения и ложного нарушения', () => {
    const files = [
      src('/** @see docs/concepts/uc-path.md# */'),
      src('/** @see docs/concepts/uc-path.md#100% */'),
    ];
    expect(checkSee(files, docs, has)).toEqual([
      'src/app/uow.ts: @see — битый якорь docs/concepts/uc-path.md#100%',
    ]);
  });
});

describe('@see в src пакета (контракт)', () => {
  it('пути живые, якоря — на заголовки', () => {
    const { files, sources, exists } = readDocs(join(import.meta.dir, '..'));
    expect(sources.map((f) => f.path)).toContain('src/app/index.ts');
    expect(checkSee(sources, files, exists)).toEqual([]);
  });
});

describe('документация пакета (контракт)', () => {
  it('ссылки живые, внутри пакета; ID правил — из docs/rules.md', () => {
    const { files, exists, rules } = readDocs(join(import.meta.dir, '..'));
    const paths = files.map((f) => f.path);
    expect(paths).toContain('llms.txt');
    expect(paths).toContain('docs/guides/use-case.md');
    expect(paths).toContain('skills/dmg-architecture/SKILL.md');
    expect(paths).toContain('agents/roles/reviewer.md');
    expect(rules.size).toBeGreaterThan(50);
    expect(checkDocs(files, exists, rules)).toEqual([]);
  });
});
