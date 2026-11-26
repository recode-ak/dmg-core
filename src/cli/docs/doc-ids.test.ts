import { describe, expect, test } from 'bun:test';
import { DocIds } from './doc-ids';
import { DocRegistries } from './doc-registries';
import { DocRegistry } from './doc-registry';
import { DocReport } from './doc-report';
import { MarkdownDoc } from './markdown-doc';

/** Текст документа из строк, с переводом строки в конце. */
const md = (...lines: string[]) => `${lines.join('\n')}\n`;

/** Реестр проекта: записи D-10 и DEBT-3, архив D-01…D-05, выдан DEBT-9. */
const REGISTRY = md(
  '# Реестр',
  '',
  '**Серия:** `D-<n>`, `DEBT-<n>`',
  '**Архив:** D-01…D-05',
  '**Последний выданный ID:** DEBT-9',
  '',
  '### D-10. Запись',
  '',
  '### DEBT-3: Долг',
);

type Files = Record<string, string>;

/** Нарушения DOC-07 по документам `docs` и исходникам `sources`. */
function check(docs: Files, sources: Files = {}) {
  const registries = new DocRegistries([
    {
      source: { name: 'проект', root: '/проект', project: true },
      registries: DocRegistry.of(
        new MarkdownDoc('docs/decisions.md', REGISTRY),
      ),
    },
  ]);
  const into = new DocReport();
  new DocIds(
    registries,
    Object.entries(docs).map(([path, text]) => new MarkdownDoc(path, text)),
    Object.entries(sources).map(([path, text]) => ({ path, text })),
  ).report(into);
  return into.violations();
}

/** Ровно одно нарушение DOC-07 на `place` («путь:строка») с ID `id`. */
function expectOne(
  violations: ReturnType<typeof check>,
  place: string,
  id: string,
) {
  const [found, ...rest] = violations;
  expect(rest).toEqual([]);
  expect(found?.rule).toBe('DOC-07');
  expect(found?.message).toStartWith(`${place} — `);
  expect(found?.message).toContain(id);
}

describe('документы .md', () => {
  test('ID без записи — DOC-07 на строке файла', () => {
    expectOne(
      check({ 'docs/a.md': md('текст', '', 'см. D-99 тут') }),
      'docs/a.md:3',
      'D-99',
    );
  });

  test('ID с записью — чисто', () => {
    expect(check({ 'docs/a.md': md('см. D-10 и DEBT-3') })).toEqual([]);
  });

  test('каждое вхождение — своё нарушение со своей строкой', () => {
    const found = check({ 'docs/a.md': md('D-99', 'текст', 'и снова D-99') });
    expect(found.map((v) => v.message.slice(0, 11))).toEqual([
      'docs/a.md:1',
      'docs/a.md:3',
    ]);
  });

  test('ID в блоке кода не берётся', () => {
    expect(check({ 'docs/a.md': md('```md', 'пример D-99', '```') })).toEqual(
      [],
    );
  });

  test('ID во front-matter не берётся', () => {
    expect(
      check({ 'docs/a.md': md('---', 'note: D-99', '---', '', 'текст') }),
    ).toEqual([]);
  });

  test('ID во вставке кода в бэктиках — проверяется', () => {
    expectOne(
      check({ 'docs/a.md': md('пример `D-99` тут') }),
      'docs/a.md:1',
      'D-99',
    );
  });

  test('номер строки считается с front-matter', () => {
    expectOne(
      check({
        'docs/a.md': md('---', 'covers: src/**', '---', '', 'см. D-99'),
      }),
      'docs/a.md:5',
      'D-99',
    );
  });
});

describe('исходники .ts', () => {
  test('ID в комментарии и в строке — берётся, на своей строке', () => {
    const found = check(
      {},
      { 'src/a.ts': md('// см. D-99', "export const note = 'D-98';") },
    );
    expect(found.map((v) => v.rule)).toEqual(['DOC-07', 'DOC-07']);
    expect(found[0]?.message).toStartWith('src/a.ts:1 — ');
    expect(found[0]?.message).toContain('D-99');
    expect(found[1]?.message).toStartWith('src/a.ts:2 — ');
    expect(found[1]?.message).toContain('D-98');
  });
});

describe('связка с разрешением ID', () => {
  test('закрытый (DEBT-7), архивный (D-3) и необъявленная серия — без нарушений', () => {
    expect(
      check(
        { 'docs/a.md': md('закрыт DEBT-7, архив D-3, локальный ФР-5, ZZ-1') },
        { 'src/a.ts': md('// DEBT-8 и D-4') },
      ),
    ).toEqual([]);
  });
});
