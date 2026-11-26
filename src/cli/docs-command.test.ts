import { describe, expect, test } from 'bun:test';
import { useTempDir } from '#core/testing/index';
import { installProvider, put } from './cli.test-kit';
import { DocsCommand } from './docs-command';
import type { DocsResult } from './docs-command.types';

const project = useTempDir('dmg-core-docs-command-project-');
const core = useTempDir('dmg-core-docs-command-core-');

/** Текст документа из строк, с переводом строки в конце. */
const md = (...lines: string[]) => `${lines.join('\n')}\n`;

const run = (...argv: string[]) =>
  new DocsCommand(project().path, core().path).run(argv);

/** Всё, что команда печатает в stdout, одним текстом. */
const printed = (result: DocsResult) => (result.out ?? []).join('\n');
const errors = (result: DocsResult) => result.messages.join('\n');

const DECISIONS = md(
  '# Решения',
  '',
  '**Серия:** `D-<n>`',
  '',
  '### D-1. Первое решение',
  '',
  'Тело первого.',
  '',
  '### D-2. Второе решение',
  '',
  'Тело второго.',
);

const RULES = md(
  '# Правила',
  '',
  '**Серия:** `ARC-<n>`',
  '',
  '| ID | Правило |',
  '|---|---|',
  '| ARC-1 | первое правило |',
);

/** Серии AR (архив AR-01…AR-20) и CL (выдан CL-30), записи AR-25 и CL-25. */
const STATUSES = md(
  '# Статусы',
  '',
  '**Серия:** `AR-<n>`, `CL-<n>`',
  '**Архив:** AR-01…AR-20',
  '**Последний выданный ID:** CL-30',
  '',
  '### AR-25. Есть',
  '',
  '### CL-25: Есть',
);

const LLMS = md(
  '# Демо',
  '',
  '- [Решения](docs/decisions.md): когда читать',
  '- [Правила](docs/rules.md): когда читать',
  '- [Статусы](docs/statuses.md): когда читать',
);

const TREE = {
  'llms.txt': LLMS,
  'docs/decisions.md': DECISIONS,
  'docs/rules.md': RULES,
  'docs/statuses.md': STATUSES,
};

/** Дерево пакета с реестром серии prefix: запись prefix-1 на строке 5. */
const packageTree = (prefix: string): Record<string, string> => ({
  'llms.txt': md('# Вход', '', '- [Реестр](docs/reg.md): когда читать'),
  'docs/reg.md': md(
    '# Реестр',
    '',
    `**Серия:** \`${prefix}-<n>\``,
    '',
    `### ${prefix}-1. Запись ${prefix}`,
  ),
});

const config = (data: unknown) => ({
  '.dmg/config.json': JSON.stringify(data),
});

/** Отказ без стека: ни строк `    at `, ни имени исключения. */
function expectNoStack(text: string) {
  expect(text).not.toMatch(/^\s+at /m);
  expect(text).not.toContain('Error:');
}

describe('show: вывод записи', () => {
  test('запись-заголовок: источник и текст записи', async () => {
    await put(project().path, TREE);
    const result = await run('show', 'D-1');
    expect(result.ok).toBe(true);
    expect(printed(result)).toBe(
      'D-1 — проект, docs/decisions.md:5\n### D-1. Первое решение\n\nТело первого.',
    );
  });

  test('запись-строка: источник, шапка таблицы и строка', async () => {
    await put(project().path, TREE);
    const result = await run('show', 'ARC-1');
    expect(result.ok).toBe(true);
    expect(printed(result)).toBe(
      [
        'ARC-1 — проект, docs/rules.md:7',
        '| ID | Правило |',
        '|---|---|',
        '| ARC-1 | первое правило |',
      ].join('\n'),
    );
  });

  test('несколько ID из проекта и поставщика одним вызовом — в порядке аргументов, через пустую строку', async () => {
    await put(project().path, {
      ...TREE,
      ...config({ providers: ['prov'] }),
    });
    await installProvider(project().path, 'prov', packageTree('PP'));
    const result = await run('show', 'ARC-1', 'PP-1', 'D-2');
    expect(result.ok).toBe(true);
    expect(printed(result)).toBe(
      [
        'ARC-1 — проект, docs/rules.md:7\n| ID | Правило |\n|---|---|\n| ARC-1 | первое правило |',
        'PP-1 — prov, node_modules/prov/docs/reg.md:5\n### PP-1. Запись PP',
        'D-2 — проект, docs/decisions.md:9\n### D-2. Второе решение\n\nТело второго.',
      ].join('\n\n'),
    );
  });

  test('вход дерева проекта пропущен — show не мешает: запись поставщика находится', async () => {
    await put(project().path, config({ providers: ['prov'] }));
    await installProvider(project().path, 'prov', packageTree('PP'));
    const result = await run('show', 'PP-1');
    expect(result.ok).toBe(true);
    expect(printed(result)).toContain('PP-1 — prov');
  });
});

describe('show --titles', () => {
  test.each([
    [['show', '--titles', 'D-1', 'ARC-1']],
    [['show', 'D-1', '--titles', 'ARC-1']],
    [['show', 'D-1', 'ARC-1', '--titles']],
  ])('%j: по строке на ID — источник и заголовок, без тела', async (argv) => {
    await put(project().path, TREE);
    const result = await run(...argv);
    expect(result.ok).toBe(true);
    const lines = printed(result).split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toStartWith('D-1 — проект, docs/decisions.md:5');
    expect(lines[0]).toContain('Первое решение');
    expect(lines[1]).toStartWith('ARC-1 — проект, docs/rules.md:7');
    expect(lines[1]).toContain('| ARC-1 | первое правило |');
    expect(printed(result)).not.toContain('Тело первого.');
  });
});

describe('show: ненайденные ID — код 1', () => {
  test.each([
    ['нет записи', 'AR-999', 'нет записи'],
    ['закрыта', 'CL-28', 'закрыта'],
    ['архив', 'AR-10', 'запись у проекта-источника'],
    ['серия не объявлена', 'ZZ-1', 'не объявлена'],
  ])('%s: причина в messages, stdout пуст', async (_status, id, reason) => {
    await put(project().path, TREE);
    const result = await run('show', id);
    expect(result.ok).toBe(false);
    expect(result.usage).toBeUndefined();
    expect(errors(result)).toContain(id);
    expect(errors(result)).toContain(reason);
    expect(printed(result)).toBe('');
  });

  test('найденные — в stdout, ненайденные — причиной в messages', async () => {
    await put(project().path, TREE);
    const result = await run('show', 'D-1', 'AR-999');
    expect(result.ok).toBe(false);
    expect(result.usage).toBeUndefined();
    expect(printed(result)).toStartWith('D-1 — проект');
    expect(printed(result)).not.toContain('AR-999');
    expect(errors(result)).toContain('AR-999');
  });
});

describe('show: ошибки ввода — usage', () => {
  test.each([
    ['нет ID', ['show']],
    ['аргумент не ID', ['show', 'foo']],
    ['неизвестный флаг', ['show', '--fix', 'D-1']],
  ])('%s', async (_name, argv) => {
    await put(project().path, TREE);
    const result = await run(...argv);
    expect(result.ok).toBe(false);
    expect(result.usage).toBe(true);
    expect(printed(result)).toBe('');
  });

  test('неизвестный флаг назван в сообщении', async () => {
    const result = await run('show', '--fix', 'D-1');
    expect(errors(result)).toContain('--fix');
  });
});

describe('show: отказы состояния проекта — код 1 без стека', () => {
  test('кривая секция конфига', async () => {
    await put(project().path, {
      ...TREE,
      ...config({ docs: { entries: 'llms.txt' } }),
    });
    const result = await run('show', 'D-1');
    expect(result.ok).toBe(false);
    expect(result.usage).toBeUndefined();
    expect(errors(result)).toContain('.dmg/config.json: docs.entries');
    expectNoStack(errors(result));
  });

  test('поставщик из providers не установлен', async () => {
    await put(project().path, {
      ...TREE,
      ...config({ providers: ['absent-pkg'] }),
    });
    const result = await run('show', 'D-1');
    expect(result.ok).toBe(false);
    expect(result.usage).toBeUndefined();
    expect(errors(result)).toContain('absent-pkg');
    expectNoStack(errors(result));
  });
});

describe('--check: связка с реестрами и ID', () => {
  const ENTRY = md(
    '# Демо',
    '',
    '- [А](docs/a.md): когда читать',
    '- [Решения](docs/decisions.md): когда читать',
  );

  test('DOC-06 реестра и DOC-07 документа — в отчёте, код 1', async () => {
    await put(project().path, {
      'llms.txt': ENTRY,
      'docs/a.md': md('см. D-99'),
      'docs/decisions.md': md(
        '# Решения',
        '',
        '**Серия:** `D-<n>`',
        '',
        '### D-1. Раз',
        '',
        '### D-1. Снова',
      ),
    });
    const result = await run('--check');
    expect(result.ok).toBe(false);
    expect(result.usage).toBeUndefined();
    const rows = result.messages;
    expect(rows).toHaveLength(3);
    expect(rows[0]).toStartWith('DOC-07: docs/a.md:1 — ');
    expect(rows[1]).toStartWith('DOC-06: docs/decisions.md:7 — ');
    expect(rows[2]).toContain('нарушений — 2');
  });

  test('ID из исходника .ts без записи — DOC-07', async () => {
    await put(project().path, {
      'llms.txt': ENTRY,
      'docs/a.md': md('текст'),
      'docs/decisions.md': DECISIONS,
      'src/a.ts': '// см. D-99\n',
    });
    const result = await run('--check');
    expect(result.ok).toBe(false);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toStartWith('DOC-07: src/a.ts:1 — ');
  });

  test('ID с записью у ядра и поставщика — чисто, без записи — DOC-07', async () => {
    await put(core().path, packageTree('CC'));
    await put(project().path, {
      'llms.txt': md('# Демо', '', '- [А](docs/a.md): когда читать'),
      'docs/a.md': md('ядро CC-1, поставщик PP-1 и CC-99'),
      ...config({ providers: ['prov'] }),
    });
    await installProvider(project().path, 'prov', packageTree('PP'));
    const result = await run('--check');
    expect(result.ok).toBe(false);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toStartWith('DOC-07: docs/a.md:1 — ');
    expect(result.messages[0]).toContain('CC-99');
  });

  test('ID в документе вне обхода (читается ради якорей) не проверяется', async () => {
    await put(project().path, {
      'llms.txt': ENTRY,
      'docs/a.md': md('[чужой](../node_modules/dep/README.md) и D-98'),
      'docs/decisions.md': DECISIONS,
      'node_modules/dep/README.md': md('# Чужой', '', 'D-99'),
    });
    const result = await run('--check');
    expect(result.ok).toBe(false);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toStartWith('DOC-07: docs/a.md:1 — ');
    expect(result.messages[0]).toContain('D-98');
  });
});
