import { expect, test } from 'bun:test';
import { GenKinds } from './gen-kinds';
import type { GenProviderKind } from './gen-provider.types';
import { ProjectConfigError } from './project-config';

// Каталог видов: свои виды `dmg-core` и виды поставщиков (владельцы, конфликты,
// подсказка). Путь вида через `runGen` — в `main.test.ts`.

const BASE_USAGE =
  'Использование: dmg-core gen <вид> <модуль>[.<агрегат>] [<имя>] [--write] [--dry-run] [--adopt]\n' +
  'Виды: module, aggregate, uc, er, job, dcs, dqs';

const PROVIDERS_HEADER =
  'Виды поставщиков (dmg-core gen <вид> <аргументы> [--write] [--dry-run] [--adopt]):';

const kind = (name: string, usage = '<модуль>'): GenProviderKind => ({
  name,
  usage,
  plan: () => ({ files: [], edits: [] }),
});

const conflict = (make: () => GenKinds): unknown => {
  try {
    make();
  } catch (error) {
    return error;
  }
  return undefined;
};

test('без поставщиков usage — прежний USAGE: две строки, байт в байт', () => {
  expect(new GenKinds().usage()).toBe(BASE_USAGE);
  expect(new GenKinds([{ owner: 'a', kinds: [] }]).usage()).toBe(BASE_USAGE);
});

test('с поставщиками usage дописывает блок: строка на вид, владелец — пакет', () => {
  const kinds = new GenKinds([
    { owner: 'example-provider', kinds: [kind('example-unit')] },
    {
      owner: 'other',
      kinds: [kind('widget', '<имя> <канал>'), kind('bare', '')],
    },
  ]);

  expect(kinds.usage()).toBe(
    `${BASE_USAGE}\n${PROVIDERS_HEADER}\n` +
      '  example-unit <модуль> — example-provider\n' +
      '  widget <имя> <канал> — other\n' +
      '  bare — other',
  );
});

test('find — вид поставщика с владельцем; свой вид находится; чужого имени нет', () => {
  const unit = kind('example-unit');
  const kinds = new GenKinds([{ owner: 'example-provider', kinds: [unit] }]);

  expect(kinds.find('example-unit')).toEqual({
    owner: 'example-provider',
    kind: unit,
  });
  expect(kinds.find('module')).toBeDefined();
  expect(kinds.find('ghost')).toBeUndefined();
});

test('вид поставщика совпал со своим — отказ с обоими владельцами', () => {
  const error = conflict(
    () => new GenKinds([{ owner: 'a', kinds: [kind('module')] }]),
  );

  expect(error).toBeInstanceOf(ProjectConfigError);
  expect((error as Error).message).toBe(
    '.dmg/config.json: providers — вид «module» есть у dmg-core и a',
  );
});

test('два поставщика с одним видом — отказ с владельцами в порядке входа', () => {
  const a = { owner: 'a', kinds: [kind('x')] };
  const b = { owner: 'b', kinds: [kind('x')] };

  expect((conflict(() => new GenKinds([a, b])) as Error).message).toBe(
    '.dmg/config.json: providers — вид «x» есть у a и b',
  );
  expect((conflict(() => new GenKinds([b, a])) as Error).message).toBe(
    '.dmg/config.json: providers — вид «x» есть у b и a',
  );
});
