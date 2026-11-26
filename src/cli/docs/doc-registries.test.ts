import { describe, expect, test } from 'bun:test';
import { DocRegistries } from './doc-registries';
import { DocRegistry } from './doc-registry';
import { DocReport } from './doc-report';
import type { DocSourceRegistries } from './docs.types';
import { MarkdownDoc } from './markdown-doc';

/** Текст документа из строк, с переводом строки в конце. */
const md = (...lines: string[]) => `${lines.join('\n')}\n`;

/** Источник реестров из файлов в памяти (путь → текст). */
function source(
  name: string,
  files: Record<string, string>,
  project = false,
): DocSourceRegistries {
  return {
    source: { name, root: `/${name}`, project },
    registries: Object.entries(files).flatMap(([path, text]) =>
      DocRegistry.of(new MarkdownDoc(path, text)),
    ),
  };
}

const project = (files: Record<string, string>) =>
  source('проект', files, true);

/** Реестр одной серии с записями `### <prefix>-<n>. Запись`. */
const owner =
  (prefix: string, ...head: string[]) =>
  (...numbers: number[]) =>
    md(
      '# Реестр',
      '',
      `**Серия:** \`${prefix}-<n>\``,
      ...head,
      ...numbers.flatMap((n) => ['', `### ${prefix}-${n}. Запись ${n}`]),
    );

/** Реестр-держатель архива серии prefix с записями. */
const holder = (prefix: string, ...numbers: number[]) =>
  md(
    '# История',
    '',
    `**Архив:** \`${prefix}-<n>\``,
    ...numbers.flatMap((n) => ['', `### ${prefix}-${n}. Запись ${n}`]),
  );

function report(...sources: DocSourceRegistries[]) {
  const into = new DocReport();
  new DocRegistries(sources).report(into);
  return into.violations();
}

describe('find: записи с источником', () => {
  test('запись проекта — вместе с источником', () => {
    const registries = new DocRegistries([
      project({ 'docs/decisions.md': owner('D')(5) }),
    ]);
    const [found, ...rest] = registries.find('D-5');
    expect(rest).toEqual([]);
    expect(found?.source).toEqual({
      name: 'проект',
      root: '/проект',
      project: true,
    });
    expect(found?.record).toMatchObject({
      id: 'D-5',
      path: 'docs/decisions.md',
    });
  });

  test('источники — в порядке на входе: проект, ядро, поставщики', () => {
    const registries = new DocRegistries([
      source('проект', { 'a.md': holder('D', 5) }, true),
      source('dmg-core', { 'b.md': owner('D')(5) }),
      source('zeta', { 'c.md': holder('D', 5) }),
      source('alpha', { 'd.md': holder('D', 5) }),
    ]);
    expect(registries.find('D-5').map((f) => f.source.name)).toEqual([
      'проект',
      'dmg-core',
      'zeta',
      'alpha',
    ]);
  });

  test('номер — числом: D-5 находит запись D-05', () => {
    const registries = new DocRegistries([
      project({ 'docs/decisions.md': owner('D')(5).replace('D-5.', 'D-05.') }),
    ]);
    expect(registries.find('D-5').map((f) => f.record.id)).toEqual(['D-05']);
  });

  test('записи нет — пусто', () => {
    const registries = new DocRegistries([
      project({ 'docs/decisions.md': owner('D')(1) }),
    ]);
    expect(registries.find('D-2')).toEqual([]);
  });
});

describe('grammar: префиксы всех объявленных серий', () => {
  test('серии проекта и поставщика; необъявленный префикс не берётся', () => {
    const registries = new DocRegistries([
      project({ 'a.md': owner('AA')(1) }),
      source('prov', { 'b.md': owner('BB')(1) }),
    ]);
    const ids = registries
      .grammar()
      .find('AA-1 BB-2 ZZ-3')
      .map((m) => m.id);
    expect(ids).toEqual(['AA-1', 'BB-2']);
  });
});

describe('resolve: разрешение ID', () => {
  test('запись есть — record с найденной записью', () => {
    const registries = new DocRegistries([
      project({ 'docs/decisions.md': owner('D')(5) }),
    ]);
    const resolved = registries.resolve('D', 5);
    expect(resolved.status).toBe('record');
    if (resolved.status !== 'record') throw new Error('нужен record');
    expect(resolved.found.map((f) => f.record.id)).toEqual(['D-5']);
  });

  test('запись важнее закрытости: номер не больше «Последнего выданного», но запись есть', () => {
    const registries = new DocRegistries([
      project({
        'debt.md': owner('DEBT', '**Последний выданный ID:** DEBT-9')(3),
      }),
    ]);
    expect(registries.resolve('DEBT', 3).status).toBe('record');
  });

  test('закрыта: номер не больше «Последнего выданного» владельца, записи нет — даже в другом источнике', () => {
    const registries = new DocRegistries([
      project({ 'a.md': md('# Тема', '', 'текст') }),
      source('dmg-core', {
        'debt.md': owner('DEBT', '**Последний выданный ID:** DEBT-9')(3),
      }),
    ]);
    expect(registries.resolve('DEBT', 7).status).toBe('closed');
  });

  test('архив: номер в диапазоне «Архива» владельца, записи нет ни в одном реестре', () => {
    const registries = new DocRegistries([
      project({ 'a.md': md('# Тема', '', 'текст') }),
      source('dmg-core', {
        'decisions.md': owner('D', '**Архив:** D-01…D-20')(30),
      }),
    ]);
    expect(registries.resolve('D', 5).status).toBe('archive');
  });

  test('архив: запись есть у держателя — record, не archive', () => {
    const registries = new DocRegistries([
      project({ 'history.md': holder('D', 5) }),
      source('dmg-core', {
        'decisions.md': owner('D', '**Архив:** D-01…D-20')(30),
      }),
    ]);
    expect(registries.resolve('D', 5).status).toBe('record');
  });

  test.each([
    ['выше диапазона архива', 'D', 21],
    ['далеко за максимумом', 'D', 999],
  ])('нет записи: %s', (_name, prefix, number) => {
    const registries = new DocRegistries([
      source('dmg-core', {
        'decisions.md': owner('D', '**Архив:** D-01…D-20')(30),
      }),
    ]);
    expect(registries.resolve(prefix, number).status).toBe('missing');
  });

  test('серия не объявлена ни в одном реестре', () => {
    const registries = new DocRegistries([
      project({ 'docs/decisions.md': owner('D')(1) }),
    ]);
    expect(registries.resolve('ZZ', 1).status).toBe('undeclared');
  });
});

describe('report: DOC-06 между реестрами', () => {
  test('префикс объявлен «Серией» у проекта и у поставщика — нарушение у реестра проекта', () => {
    const [found, ...rest] = report(
      project({ 'docs/decisions.md': owner('QQ')(1) }),
      source('prov', { 'docs/reg.md': owner('QQ')(2) }),
    );
    expect(rest).toEqual([]);
    expect(found?.rule).toBe('DOC-06');
    expect(found?.message).toStartWith('docs/decisions.md');
    expect(found?.message).toContain('QQ');
  });

  test('префикс объявлен «Серией» у двух поставщиков без проекта — нарушение у реестра поставщика, объявившего позже', () => {
    const [found, ...rest] = report(
      project({ 'docs/a.md': md('# Тема', '', 'текст') }),
      source('first', { 'docs/reg.md': owner('QQ')(1) }),
      source('second', { 'docs/reg.md': owner('QQ')(2) }),
    );
    expect(rest).toEqual([]);
    expect(found?.rule).toBe('DOC-06');
    expect(found?.message).toStartWith('/second/docs/reg.md');
    expect(found?.message).toContain('QQ');
  });

  test('префикс объявлен в двух реестрах проекта — нарушение', () => {
    const [found, ...rest] = report(
      project({ 'docs/a.md': owner('QQ')(1), 'docs/b.md': owner('QQ')(2) }),
    );
    expect(rest).toEqual([]);
    expect(found?.rule).toBe('DOC-06');
    expect(found?.message).toMatch(/^docs\/[ab]\.md/);
    expect(found?.message).toContain('QQ');
  });

  test('«Серия» владельца и «Архив»-серия держателя — чисто', () => {
    expect(
      report(
        project({ 'docs/history.md': holder('D', 5) }),
        source('dmg-core', { 'docs/decisions.md': owner('D')(6) }),
      ),
    ).toEqual([]);
  });

  test('номер есть у владельца и у держателя архива — нарушение у реестра проекта', () => {
    const [found, ...rest] = report(
      project({ 'docs/history.md': holder('D', 5) }),
      source('dmg-core', { 'docs/decisions.md': owner('D')(5) }),
    );
    expect(rest).toEqual([]);
    expect(found?.rule).toBe('DOC-06');
    expect(found?.message).toStartWith('docs/history.md');
    expect(found?.message).toContain('D-5');
  });

  test('одна запись в двух реестрах проекта — нарушение', () => {
    const [found, ...rest] = report(
      project({
        'docs/a.md': holder('D', 1),
        'docs/b.md': holder('D', 1),
      }),
      source('dmg-core', { 'docs/decisions.md': owner('D')(9) }),
    );
    expect(rest).toEqual([]);
    expect(found?.rule).toBe('DOC-06');
    expect(found?.message).toMatch(/^docs\/[ab]\.md/);
    expect(found?.message).toContain('D-1');
  });

  test('нарушения внутри реестров поставщика не выводятся', () => {
    const broken = md(
      '# Реестр',
      '',
      '**Серия:** `PP-<n>`',
      '',
      '### PP-1. Раз',
      '',
      '### PP-1. Снова',
      '',
      '### Без ID',
    );
    expect(report(source('prov', { 'docs/reg.md': broken }))).toEqual([]);
  });

  test('связка: DOC-06 реестра проекта попадает в отчёт', () => {
    const [found, ...rest] = report(
      project({
        'docs/decisions.md': md(
          '# Решения',
          '',
          '**Серия:** `D-<n>`',
          '',
          '### D-1. Раз',
          '',
          '### D-1. Снова',
        ),
      }),
    );
    expect(rest).toEqual([]);
    expect(found?.rule).toBe('DOC-06');
    expect(found?.message).toStartWith('docs/decisions.md:7 — ');
  });
});

describe('pathOf: путь файла источника', () => {
  const registries = new DocRegistries([
    project({}),
    {
      source: {
        name: 'prov',
        root: '/проект/node_modules/prov',
        project: false,
      },
      registries: [],
    },
  ]);
  const inside = {
    name: 'prov',
    root: '/проект/node_modules/prov',
    project: false,
  };
  const outside = { name: 'dmg-core', root: '/ядро', project: false };

  test('проект — путь как есть', () => {
    expect(
      registries.pathOf(
        { name: 'проект', root: '/проект', project: true },
        'docs/a.md',
      ),
    ).toBe('docs/a.md');
  });

  test('источник внутри корня проекта — от корня проекта', () => {
    expect(registries.pathOf(inside, 'docs/reg.md')).toBe(
      'node_modules/prov/docs/reg.md',
    );
  });

  test('источник вне корня проекта — абсолютный', () => {
    expect(registries.pathOf(outside, 'docs/reg.md')).toBe('/ядро/docs/reg.md');
  });

  test('без источника-проекта — абсолютный', () => {
    expect(new DocRegistries([]).pathOf(inside, 'docs/reg.md')).toBe(
      '/проект/node_modules/prov/docs/reg.md',
    );
  });
});
