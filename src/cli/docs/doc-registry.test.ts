import { describe, expect, test } from 'bun:test';
import { DocRegistry } from './doc-registry';
import { DocReport } from './doc-report';
import { MarkdownDoc } from './markdown-doc';

const PATH = 'docs/decisions.md';

/** Текст документа из строк, с переводом строки в конце. */
const md = (...lines: string[]) => `${lines.join('\n')}\n`;

const registries = (text: string, path = PATH) =>
  DocRegistry.of(new MarkdownDoc(path, text));

/** Ровно один реестр документа. */
function only(text: string, path = PATH): DocRegistry {
  const found = registries(text, path);
  expect(found).toHaveLength(1);
  return found[0] as DocRegistry;
}

function problems(registry: DocRegistry) {
  const into = new DocReport();
  registry.report(into);
  return into.violations();
}

/** Ровно одно нарушение DOC-06 на строке `line` файла. */
function expectOneAt(registry: DocRegistry, line: number, path = PATH) {
  const [found, ...rest] = problems(registry);
  expect(rest).toEqual([]);
  expect(found?.rule).toBe('DOC-06');
  expect(found?.message).toStartWith(`${path}:${line} — `);
  return found;
}

const SERIES_D = '**Серия:** `D-<n>`';

describe('не реестр', () => {
  test('документ без «Серии» и «Архива» — реестров нет', () => {
    expect(registries(md('# Тема', '', 'текст'))).toEqual([]);
  });

  test('таблица ID без шапки реестра — не реестр', () => {
    const text = md('# Тема', '', '| ID | Что |', '|---|---|', '| D-1 | x |');
    expect(registries(text)).toEqual([]);
  });
});

describe('шапка: «Серия»', () => {
  test('одна серия: префикс без номера и путь реестра', () => {
    const registry = only(md('# Решения', '', SERIES_D));
    expect(registry.series).toEqual(['D']);
    expect(registry.path).toBe(PATH);
    expect(registry.records).toEqual([]);
    expect(problems(registry)).toEqual([]);
  });

  test('несколько серий через запятую, префикс из нескольких частей', () => {
    const registry = only(
      md('# Правила', '', '**Серия:** `ARC-<n>`, `DOM-<n>`, `D-UI-<n>`'),
    );
    expect(registry.series).toEqual(['ARC', 'DOM', 'D-UI']);
    expect(problems(registry)).toEqual([]);
  });

  test.each([
    ['без бэктиков', '**Серия:** D-<n>'],
    ['номер вместо <n>', '**Серия:** `D-1`'],
    ['префикс строчными', '**Серия:** `d-<n>`'],
    ['пусто', '**Серия:**'],
  ])('не по форме (%s) — DOC-06 на строке серии', (_name, line) => {
    expectOneAt(only(md('# Решения', '', line)), 3);
  });

  test.each([
    ['«Серия»', '**Серия:** `X-<n>`'],
    ['«Архив»', '**Архив:** `D-01…D-05`'],
  ])('%s не первой строкой раздела — DOC-06 на этой строке', (_name, line) => {
    const registry = only(
      md('# Решения', '', SERIES_D, '', '## Группа', '', 'текст', '', line),
    );
    expectOneAt(registry, 9);
  });

  test('«Серия» в блоке кода — пример, не объявление', () => {
    const registry = only(
      md(
        '# Решения',
        '',
        SERIES_D,
        '',
        '## Группа',
        '',
        '```md',
        '**Серия:** `X-<n>`',
        '```',
      ),
    );
    expect(registry.series).toEqual(['D']);
    expect(problems(registry)).toEqual([]);
  });
});

describe('шапка: «Архив»', () => {
  test.each([
    ['без бэктиков', '**Архив:** D-01…D-101'],
    ['в бэктиках', '**Архив:** `D-01…D-101`'],
  ])('диапазон владельца (%s) — чисто', (_name, line) => {
    const registry = only(md('# Решения', '', SERIES_D, line));
    expect(registry.series).toEqual(['D']);
    expect(problems(registry)).toEqual([]);
  });

  test('диапазон чужого префикса — DOC-06 на строке архива', () => {
    const registry = only(
      md('# Решения', '', SERIES_D, '**Архив:** X-01…X-05'),
    );
    expectOneAt(registry, 4);
  });

  test('архив-серия у держателя: реестр без «Серии», запись архивной серии — запись', () => {
    const registry = only(
      md('# История', '', '**Архив:** `D-<n>`', '', '### D-7. Старое решение'),
    );
    expect(registry.series).toEqual([]);
    expect(registry.records.map((r) => r.id)).toEqual(['D-7']);
    expect(problems(registry)).toEqual([]);
  });

  test('`###` чужой серии у держателя — DOC-06', () => {
    const registry = only(
      md('# История', '', '**Архив:** `D-<n>`', '', '### X-1. Чужая'),
    );
    expectOneAt(registry, 5);
  });
});

describe('шапка: «Последний выданный ID»', () => {
  const DEBT = '**Серия:** `DEBT-<n>`';
  const records = ['### DEBT-1: первый', '', '### DEBT-7: седьмой'];
  const withLast = (...last: string[]) =>
    only(md('# Долг', '', DEBT, ...last, '', ...records));

  test.each([
    ['в бэктиках', '**Последний выданный ID:** `DEBT-7`'],
    ['без бэктиков', '**Последний выданный ID:** DEBT-7'],
  ])('равен максимуму (%s) — чисто, номер читается', (_name, line) => {
    const registry = withLast(line);
    expect(registry.lastIssued.get('DEBT')).toBe(7);
    expect(problems(registry)).toEqual([]);
  });

  test('больше максимума — чисто', () => {
    const registry = withLast('**Последний выданный ID:** DEBT-9');
    expect(registry.lastIssued.get('DEBT')).toBe(9);
    expect(problems(registry)).toEqual([]);
  });

  test('меньше максимума — DOC-06 на этой строке', () => {
    expectOneAt(withLast('**Последний выданный ID:** DEBT-5'), 4);
  });

  test('вторая строка той же серии — DOC-06 на второй', () => {
    expectOneAt(
      withLast(
        '**Последний выданный ID:** DEBT-8',
        '**Последний выданный ID:** DEBT-9',
      ),
      5,
    );
  });

  test('чужая серия — DOC-06 на этой строке', () => {
    expectOneAt(withLast('**Последний выданный ID:** D-3'), 4);
  });

  test('по строке на каждую серию реестра — чисто', () => {
    const registry = only(
      md(
        '# Долг и вопросы',
        '',
        '**Серия:** `DEBT-<n>`, `DISC-<n>`',
        '**Последний выданный ID:** DEBT-4',
        '**Последний выданный ID:** DISC-2',
        '',
        '### DEBT-4: долг',
        '',
        '### DISC-1. Вопрос',
      ),
    );
    expect([...registry.lastIssued]).toEqual([
      ['DEBT', 4],
      ['DISC', 2],
    ]);
    expect(problems(registry)).toEqual([]);
  });

  test('записей серии нет — любой номер допустим', () => {
    const registry = only(
      md(
        '# Вопросы',
        '',
        '**Серия:** `DISC-<n>`',
        '**Последний выданный ID:** DISC-3',
      ),
    );
    expect(problems(registry)).toEqual([]);
  });
});

describe('запись-заголовок', () => {
  test('`. ` и `: ` — разделитель; поля записи', () => {
    const registry = only(
      md(
        '# Реестр',
        '',
        '**Серия:** `D-<n>`, `DEBT-<n>`',
        '',
        '### D-01. Первое решение',
        '',
        'тело',
        '',
        '### DEBT-2: Второй долг',
      ),
    );
    expect(registry.records).toEqual([
      {
        id: 'D-01',
        prefix: 'D',
        number: 1,
        title: 'Первое решение',
        text: '### D-01. Первое решение\n\nтело',
        path: PATH,
        line: 5,
        form: 'heading',
      },
      {
        id: 'DEBT-2',
        prefix: 'DEBT',
        number: 2,
        title: 'Второй долг',
        text: '### DEBT-2: Второй долг',
        path: PATH,
        line: 9,
        form: 'heading',
      },
    ]);
    expect(problems(registry)).toEqual([]);
  });

  test.each([
    ['нет разделителя', '### D-4 суть'],
    ['пустая суть после точки', '### D-5.'],
    ['пустая суть с пробелом', '### D-6. '],
    ['нет ID', '### Просто заголовок'],
    ['ID чужой серии', '### X-1. Чужая'],
  ])('%s — DOC-06 на заголовке, записи нет', (_name, heading) => {
    const registry = only(md('# Решения', '', SERIES_D, '', heading));
    expectOneAt(registry, 5);
    expect(registry.records).toEqual([]);
  });
});

describe('тело записи', () => {
  const body = (terminator: string) =>
    only(
      md(
        '# Решения',
        '',
        SERIES_D,
        '',
        '### D-1. Первое',
        '',
        'Тело первое.',
        '',
        terminator,
      ),
    );

  test.each(['### D-2. Второе', '## Группа', '# Верхний заголовок'])(
    'кончается на «%s», хвостовые пустые строки отрезаны',
    (terminator) => {
      const [first] = body(terminator).records;
      expect(first?.text).toBe('### D-1. Первое\n\nТело первое.');
    },
  );

  test('`###` в блоке кода, `####`, список и абзацы — внутри записи', () => {
    const registry = only(
      md(
        '# Решения',
        '',
        SERIES_D,
        '',
        '### D-1. Первое',
        '',
        'Абзац.',
        '',
        '#### Подраздел',
        '- пункт',
        '',
        '```md',
        '### D-9. пример',
        '```',
        '',
        '### D-2. Второе',
      ),
    );
    expect(registry.records.map((r) => r.id)).toEqual(['D-1', 'D-2']);
    expect(registry.records[0]?.text).toBe(
      [
        '### D-1. Первое',
        '',
        'Абзац.',
        '',
        '#### Подраздел',
        '- пункт',
        '',
        '```md',
        '### D-9. пример',
        '```',
      ].join('\n'),
    );
    expect(problems(registry)).toEqual([]);
  });

  test('хвостовые `---` и пустые строки отрезаны', () => {
    const registry = only(
      md(
        '# Решения',
        '',
        SERIES_D,
        '',
        '### D-1. Первое',
        '',
        'тело',
        '',
        '---',
        '',
        '### D-2. Второе',
        '',
        'тело два',
        '',
        '---',
        '',
      ),
    );
    expect(registry.records.map((r) => r.text)).toEqual([
      '### D-1. Первое\n\nтело',
      '### D-2. Второе\n\nтело два',
    ]);
  });
});

describe('запись-строка', () => {
  const TABLE = [
    '| ID | Правило |',
    '|---|---|',
    '| ARC-1 | Первое |',
    '| ARC-2 | Второе |',
  ];
  const HEAD = ['# Правила', '', '**Серия:** `ARC-<n>`', ''];

  test('таблица с первой колонкой ID: запись — шапка, разделитель и строка', () => {
    const registry = only(md(...HEAD, ...TABLE));
    expect(registry.records).toEqual([
      {
        id: 'ARC-1',
        prefix: 'ARC',
        number: 1,
        title: '| ARC-1 | Первое |',
        text: '| ID | Правило |\n|---|---|\n| ARC-1 | Первое |',
        path: PATH,
        line: 7,
        form: 'row',
      },
      {
        id: 'ARC-2',
        prefix: 'ARC',
        number: 2,
        title: '| ARC-2 | Второе |',
        text: '| ID | Правило |\n|---|---|\n| ARC-2 | Второе |',
        path: PATH,
        line: 8,
        form: 'row',
      },
    ]);
    expect(problems(registry)).toEqual([]);
  });

  test('таблица «Правило» повторяет ID — это ссылки, не записи', () => {
    const registry = only(
      md(
        ...HEAD,
        ...TABLE,
        '',
        '## Карта',
        '',
        '| Правило | Что |',
        '|---|---|',
        '| ARC-1 | карта |',
      ),
    );
    expect(registry.records.map((r) => r.id)).toEqual(['ARC-1', 'ARC-2']);
    expect(problems(registry)).toEqual([]);
  });

  test('в реестре-файле таблица считается и внутри группы `##`', () => {
    const registry = only(md(...HEAD, '## Группа', '', ...TABLE));
    expect(registry.records.map((r) => r.id)).toEqual(['ARC-1', 'ARC-2']);
  });

  test.each([
    ['ID чужой серии', '| X-9 | чужая |'],
    ['не ID', '| текст | не запись |'],
  ])('строка таблицы: %s — DOC-06 на строке', (_name, row) => {
    const registry = only(md(...HEAD, '| ID | Правило |', '|---|---|', row));
    expectOneAt(registry, 7);
    expect(registry.records).toEqual([]);
  });
});

describe('дубли внутри реестра', () => {
  test.each([
    ['один ID дважды', ['### D-1. Первое', '', '### D-1. Снова'], 7],
    ['D-01 и D-1 — один ID', ['### D-01. Первое', '', '### D-1. Снова'], 7],
    [
      'строка таблицы дважды',
      ['| ID | Что |', '|---|---|', '| D-1 | а |', '| D-1 | б |'],
      8,
    ],
  ])('%s — DOC-06 на второй записи', (_name, lines, line) => {
    const registry = only(md('# Решения', '', SERIES_D, '', ...lines));
    const found = expectOneAt(registry, line as number);
    expect(found?.message).toContain('D-1');
  });
});

describe('раздел-реестр', () => {
  const SECTION = (end: string) =>
    md(
      '# Слои',
      '',
      'Вводный текст.',
      '',
      '## Сценарии роста',
      '',
      '**Серия:** `GR-<n>`',
      '',
      '| ID | Сценарий |',
      '|---|---|',
      '| GR-1 | рост |',
      '',
      end,
      '',
      '| ID | Что |',
      '|---|---|',
      '| GR-2 | вне раздела |',
    );

  test.each(['## Другое', '# Другое'])(
    'записи — только внутри раздела (до «%s»), файл — не реестр',
    (end) => {
      const text = SECTION(end);
      const registry = only(text, 'docs/layers.md');
      expect(registry.series).toEqual(['GR']);
      expect(registry.path).toBe('docs/layers.md');
      expect(registry.records.map((r) => [r.id, r.line])).toEqual([
        ['GR-1', 11],
      ]);
      expect(new MarkdownDoc('docs/layers.md', text).isRegistry()).toBe(false);
    },
  );

  test('несколько разделов-реестров — по реестру на раздел', () => {
    const found = registries(
      md(
        '# Слои',
        '',
        '## Первый',
        '',
        '**Серия:** `GR-<n>`',
        '',
        '## Второй',
        '',
        '**Серия:** `SC-<n>`',
      ),
      'docs/layers.md',
    );
    expect(found.map((r) => r.series)).toEqual([['GR'], ['SC']]);
  });

  test('раздел без строки «Серия» — не реестр', () => {
    const text = md(
      '# Слои',
      '',
      '## Раздел',
      '',
      '| ID | Что |',
      '|---|---|',
      '| GR-1 | x |',
    );
    expect(registries(text, 'docs/layers.md')).toEqual([]);
  });

  test('форма записи проверяется и в разделе: строка чужого ID — DOC-06', () => {
    const registry = only(
      md(
        '# Слои',
        '',
        '## Сценарии',
        '',
        '**Серия:** `GR-<n>`',
        '',
        '| ID | Что |',
        '|---|---|',
        '| X-1 | чужая |',
      ),
      'docs/layers.md',
    );
    expectOneAt(registry, 9, 'docs/layers.md');
  });
});

describe('строки «Серия» и «Архив» не на месте в листе', () => {
  test.each([
    ['«Серия»', '**Серия:** `GR-<n>`'],
    ['«Архив»', '**Архив:** `D-<n>`'],
  ])(
    '%s не первой строкой раздела листа — DOC-06, серий и записей нет',
    (_name, line) => {
      const registry = only(
        md(
          '# Слои',
          '',
          '## Сценарии',
          '',
          'Вводный текст.',
          '',
          line,
          '',
          '| ID | Что |',
          '|---|---|',
          '| GR-1 | x |',
        ),
        'docs/layers.md',
      );
      expectOneAt(registry, 7, 'docs/layers.md');
      expect(registry.series).toEqual([]);
      expect(registry.records).toEqual([]);
    },
  );

  test('после `###` в начале листа — не шапка: DOC-06', () => {
    const registry = only(md('# Т', '', '### Тема', '', SERIES_D), 'docs/a.md');
    expectOneAt(registry, 5, 'docs/a.md');
  });
});

describe('раздел-реестр: подзаголовки', () => {
  test('`###` без ID серии в разделе — подзаголовок листа: не запись и не ошибка', () => {
    const registry = only(
      md(
        '# Слои',
        '',
        '## Сценарии',
        '',
        '**Серия:** `GR-<n>`',
        '',
        '### Как читать',
        '',
        '### X-1. Чужой ID',
        '',
        '| ID | Что |',
        '|---|---|',
        '| GR-1 | x |',
      ),
      'docs/layers.md',
    );
    expect(registry.records.map((r) => r.id)).toEqual(['GR-1']);
    expect(problems(registry)).toEqual([]);
  });

  test('`###` со своим ID в разделе — запись, не по форме — DOC-06', () => {
    const registry = only(
      md(
        '# Слои',
        '',
        '## Сценарии',
        '',
        '**Серия:** `GR-<n>`',
        '',
        '### GR-1. Рост',
        '',
        'тело',
        '',
        '### GR-2 без разделителя',
      ),
      'docs/layers.md',
    );
    expect(registry.records.map((r) => [r.id, r.text])).toEqual([
      ['GR-1', '### GR-1. Рост\n\nтело'],
    ]);
    expectOneAt(registry, 11, 'docs/layers.md');
  });
});

describe('раздел-реестр: шапка', () => {
  test('раздел открывает и строка «Архив»: записи архивной серии', () => {
    const registry = only(
      md(
        '# Слои',
        '',
        '## История',
        '',
        '**Архив:** `D-<n>`',
        '',
        '### D-7. Старое',
      ),
      'docs/layers.md',
    );
    expect(registry.archive).toEqual([{ kind: 'series', prefix: 'D' }]);
    expect(registry.records.map((r) => r.id)).toEqual(['D-7']);
    expect(problems(registry)).toEqual([]);
  });

  test('шапка раздела — весь первый абзац: «Последний выданный ID» второй строкой', () => {
    const registry = only(
      md(
        '# Слои',
        '',
        '## Сценарии',
        '',
        '**Серия:** `GR-<n>`',
        '**Последний выданный ID:** GR-3',
        '',
        '| ID | Что |',
        '|---|---|',
        '| GR-1 | x |',
      ),
      'docs/layers.md',
    );
    expect([...registry.lastIssued]).toEqual([['GR', 3]]);
    expect(problems(registry)).toEqual([]);
  });

  test('в реестре-файле «Серия» первой строкой раздела `##` — DOC-06: разделов-реестров в нём нет', () => {
    const registry = only(
      md('# Решения', '', SERIES_D, '', '## Группа', '', '**Серия:** `X-<n>`'),
    );
    expect(registry.series).toEqual(['D']);
    expectOneAt(registry, 7);
  });
});
