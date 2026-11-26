import { describe, expect, test } from 'bun:test';
import { IdGrammar } from './id-grammar';

const ids = (text: string, prefixes: string[]) =>
  new IdGrammar(prefixes).find(text).map((m) => m.id);

describe('find: объявленные префиксы', () => {
  test('ID — написание, префикс, номер числом и позиция в тексте', () => {
    const text = 'см. ARC-13 и D-114.';
    expect(new IdGrammar(['ARC', 'D']).find(text)).toEqual([
      { id: 'ARC-13', prefix: 'ARC', number: 13, index: 4 },
      { id: 'D-114', prefix: 'D', number: 114, index: text.indexOf('D-114') },
    ]);
  });

  test('ID необъявленного префикса не берётся', () => {
    expect(ids('ZZ-1 и ARC-2', ['ARC'])).toEqual(['ARC-2']);
  });

  test('ID на разных строках — все, в порядке текста', () => {
    expect(ids('ARC-1\nD-2\n\nARC-3', ['ARC', 'D'])).toEqual([
      'ARC-1',
      'D-2',
      'ARC-3',
    ]);
  });

  test('знаки препинания и скобки по краям — граница', () => {
    expect(ids('(ARC-1), `D-2`, «ARC-3»; ARC-4.', ['ARC', 'D'])).toEqual([
      'ARC-1',
      'D-2',
      'ARC-3',
      'ARC-4',
    ]);
  });

  test('диапазон ARC-14…ARC-16 — два ID', () => {
    expect(ids('ARC-14…ARC-16', ['ARC'])).toEqual(['ARC-14', 'ARC-16']);
  });

  test('D-01 и D-1 — один номер', () => {
    const found = new IdGrammar(['D']).find('D-01 и D-1');
    expect(found.map((m) => m.number)).toEqual([1, 1]);
    expect(found.map((m) => m.id)).toEqual(['D-01', 'D-1']);
  });
});

describe('find: перекрытие префиксов', () => {
  test('GR-UI-01 при объявленных GR, UI и GR-UI — серия GR-UI', () => {
    const [mention, ...rest] = new IdGrammar(['GR', 'UI', 'GR-UI']).find(
      'GR-UI-01',
    );
    expect(rest).toEqual([]);
    expect(mention).toEqual({
      id: 'GR-UI-01',
      prefix: 'GR-UI',
      number: 1,
      index: 0,
    });
  });

  test('D-UI-12 при объявленных D и D-UI — серия D-UI', () => {
    const found = new IdGrammar(['D', 'D-UI']).find('D-UI-12');
    expect(found.map((m) => m.prefix)).toEqual(['D-UI']);
    expect(found.map((m) => m.number)).toEqual([12]);
  });

  test('порядок префиксов на входе не важен', () => {
    expect(ids('GR-UI-01', ['GR-UI', 'GR', 'UI'])).toEqual(['GR-UI-01']);
  });
});

describe('find: границы', () => {
  test.each([
    ['буква слева', 'xARC-1'],
    ['кириллица слева', 'ЯARC-1'],
    ['цифра слева', '1ARC-1'],
    ['буква справа', 'ARC-1a'],
    ['дефис и цифра справа', 'ARC-1-2'],
    ['дефис слева', '-ARC-1'],
  ])('%s — не ID', (_name, text) => {
    expect(ids(text, ['ARC'])).toEqual([]);
  });

  test('C-DEBT-41 не даёт DEBT-41: слева дефис', () => {
    expect(ids('C-DEBT-41', ['DEBT'])).toEqual([]);
  });

  test('DEBT-UI-64 при необъявленном DEBT-UI не даёт UI-64', () => {
    expect(ids('DEBT-UI-64', ['UI', 'DEBT'])).toEqual([]);
  });

  test.each([['ФР-2'], ['Р-14'], ['D-<n>'], ['D-NN'], ['D-']])(
    '%s — не ID',
    (text) => {
      expect(ids(text, ['D', 'ARC'])).toEqual([]);
    },
  );
});

describe('isId: форма аргумента show', () => {
  test.each(['D-114', 'DEBT-5', 'GR-UI-01', 'D-01'])('%s — ID', (arg) => {
    expect(IdGrammar.isId(arg)).toBe(true);
  });

  test.each(['d-114', 'D-', 'foo', '--titles', 'D-1a', 'D-1-2', 'D 1', ''])(
    '«%s» — не ID',
    (arg) => {
      expect(IdGrammar.isId(arg)).toBe(false);
    },
  );
});
