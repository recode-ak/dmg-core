import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
  DebtChecker,
  type DebtInput,
  type DebtLayout,
  type DebtRegistries,
  type SourceFile,
} from '#core/arch/index';
import { useTempDir } from '#core/testing/index';

const CODE_MD = 'conductor/debt/code.md';
const PATHS = {
  code: CODE_MD,
  tests: 'conductor/debt/tests.md',
  product: 'conductor/debt/product.md',
};

const file = (path: string, text: string): SourceFile => ({ path, text });

/** Проверка проекта: долг кода `C-DEBT-<n>`, маркеры временности вне `scripts/`. */
const checker = (skip: readonly string[] = ['scripts/**']) =>
  new DebtChecker({
    idPrefix: 'C-DEBT',
    tempMarkers: { skip },
    registryPaths: PATHS,
  });

/** Реестр со строкой «Последний выданный ID» в шапке. */
const registry = (last: string | undefined, ...entries: string[]) =>
  [
    '# Реестр долга',
    ...(last ? [`**Последний выданный ID:** ${last}`] : []),
    '## 1. Группа',
    ...entries,
  ].join('\n\n');
const md = (...entries: string[]) => registry('C-DEBT-50', ...entries);

const input = (
  code: readonly SourceFile[],
  registries: DebtRegistries,
  files: readonly string[] = code.map((f) => f.path),
): DebtInput => ({ code, files, registries });

const CORE = "import { A } from 'legacy-kit';";
const ISO =
  '  // biome-ignore lint/plugin: C-DEBT-5 — дата\n  at: v.isoDateTime(),';

/** C-DEBT-1 — два glob Места списком, Корень — домен. */
const DEBT_1 = [
  '### C-DEBT-1: импорты `legacy-kit` в домене',
  '- **Место:**',
  '  - `domain/src/user/**` — перевод `user`',
  '  - `domain/src/course/**` — перевод `course`',
  "- **Признак:** `from 'legacy-kit`",
  '- **Корень:** `domain/src/**`',
  '- **Погашает:** трек `cleanup`',
  '- **Причина:** базовые классы в `legacy-kit`.',
].join('\n');
/** C-DEBT-5 — Место одной строкой (два glob и пояснение), без Корня. */
const DEBT_5 = [
  '### C-DEBT-5: `v.isoDateTime` в схемах домена',
  '- **Место:** `domain/src/user/entity.ts`, `domain/src/course/*/entity.ts` (`createdAt`; `biome-ignore`)',
  '- **Признак:** `v\\.isoDateTime`',
  '- **Триггер:** второй потребитель схем',
].join('\n');

const CODE = [
  file('domain/src/user/a.ts', CORE),
  file('domain/src/course/a.ts', CORE),
  file('domain/src/user/entity.ts', ISO),
  file('domain/src/course/lesson/entity.ts', ISO),
];
const run = (code: readonly SourceFile[], codeMd = md(DEBT_1, DEBT_5)) =>
  checker().report(input(code, { code: codeMd }));

describe('DebtChecker: разбор записи долга кода', () => {
  test('Место списком и строкой, Признак, Корень — без нарушений', () => {
    expect(run(CODE)).toEqual([]);
  });

  test('запись без Места — ошибка', () => {
    const codeMd = md(DEBT_1.replace(/- \*\*Место:\*\*\n( {2}- .*\n)+/, ''));
    expect(run(CODE.slice(0, 2), codeMd)).toEqual([
      'ARC-12: C-DEBT-1: нет поля Место',
    ]);
  });

  test('запись без Признака — ошибка', () => {
    const codeMd = md(DEBT_1.replace(/- \*\*Признак:\*\*.*\n/, ''));
    expect(run(CODE.slice(0, 2), codeMd)).toEqual([
      'ARC-12: C-DEBT-1: нет поля Признак',
    ]);
  });

  test('Признак — неверная регулярка — ошибка', () => {
    const codeMd = md(DEBT_5.replace('`v\\.isoDateTime`', '`v(`'));
    expect(run(CODE.slice(2), codeMd)).toEqual([
      'ARC-12: C-DEBT-5: Признак `v(` — неверная регулярка',
    ]);
  });

  test('Признак — регулярка с флагом m: ^ — начало строки', () => {
    const codeMd = md(
      [
        '### C-DEBT-10: приватные члены Ar',
        '- **Место:** `domain/src/course/a-root.ts`',
        '- **Признак:** `^\\s*(static\\s+)?#\\w+`',
        '- **Погашает:** трек `cleanup`',
      ].join('\n'),
    );
    const code = [
      file('domain/src/course/a-root.ts', 'class A {\n  static #x() {}\n}'),
    ];
    expect(run(code, codeMd)).toEqual([]);
  });

  test('шаблон записи в «Правилах» (C-DEBT-<n>) не считается записью', () => {
    const codeMd = md(
      '```\n### C-DEBT-<n>: <название>\n- **Место:** <glob>\n```',
      DEBT_5,
    );
    expect(run(CODE.slice(2), codeMd)).toEqual([]);
  });

  test('запись и поле внутри блока кода ``` не разбираются', () => {
    const example = [
      '```',
      '### C-DEBT-99: пример',
      '- **Место:** `nowhere/**`',
      '- **Признак:** `x`',
      '```',
    ].join('\n');
    const inEntry = `${DEBT_5}\n\`\`\`\n- **Место:** \`nowhere/**\`\n\`\`\``;
    expect(run(CODE.slice(2), md(example, inEntry))).toEqual([]);
  });

  test('пункт под другим полем, после пустой строки и вложенный — не Место', () => {
    const codeMd = md(
      [
        DEBT_1.replace(
          '- **Признак:**',
          '    - `nested()` — вложенное пояснение\n\n  - `bar()` — после пустой строки\n- **Признак:**',
        ),
        '  - `foo()` — после Причины',
      ].join('\n'),
    );
    expect(run(CODE.slice(0, 2), codeMd)).toEqual([]);
  });

  test('повторный заголовок записи — дубль', () => {
    expect(run(CODE.slice(2), md(DEBT_5, DEBT_5))).toEqual([
      'ARC-12: C-DEBT-5: дубль записи',
    ]);
  });

  test('заголовок с префиксом другого реестра — ошибка', () => {
    const codeMd = md(DEBT_5, '### DEBT-5: запись пакета');
    expect(run(CODE.slice(2), codeMd)).toEqual([
      `ARC-12: ${CODE_MD}: заголовок DEBT-5 — неверный префикс, нужен C-DEBT-<n>`,
    ]);
  });

  test('check — нарушения правила ARC-12 с сообщением без префикса', () => {
    const violations = checker().check(
      input(CODE.slice(2), { code: md(DEBT_5, DEBT_5) }),
    );
    expect(violations.map((v) => [v.rule, v.message])).toEqual([
      ['ARC-12', 'C-DEBT-5: дубль записи'],
    ]);
  });
});

describe('DebtChecker: Место', () => {
  test('glob не находит ни одного файла — устаревшее место', () => {
    expect(run(CODE.slice(1, 2), md(DEBT_1))).toEqual([
      'ARC-12: C-DEBT-1: Место `domain/src/user/**` не находит файлов — устаревшее место',
    ]);
  });

  test('признак пропал в одном glob записи с двумя Местами — долг погашен (glob)', () => {
    const code = [file('domain/src/user/a.ts', 'export {};'), ...CODE.slice(1)];
    expect(run(code)).toEqual([
      'ARC-12: C-DEBT-1: долг погашен (`domain/src/user/**`) — сними glob или закрой запись',
    ]);
  });

  test('признак есть хотя бы в одном файле glob — не погашен', () => {
    const code = [...CODE, file('domain/src/user/b.ts', 'export {};')];
    expect(run(code)).toEqual([]);
  });
});

describe('DebtChecker: Корень', () => {
  test('признак в Корне вне Места — долг без записи (файл и строка)', () => {
    const code = [...CODE, file('domain/src/stream/a.ts', `// x\n${CORE}`)];
    expect(run(code)).toEqual([
      'ARC-12: C-DEBT-1: долг без записи — domain/src/stream/a.ts:2',
    ]);
  });

  test('признак вне Корня — не ошибка', () => {
    const code = [...CODE, file('modules/stream/src/a.ts', CORE)];
    expect(run(code)).toEqual([]);
  });

  test('Корень не находит файлов — ошибка (поиск вне Места отключился бы)', () => {
    const codeMd = md(DEBT_1.replace('`domain/src/**`', '`nowhere/**`'));
    expect(run(CODE.slice(0, 2), codeMd)).toEqual([
      'ARC-12: C-DEBT-1: Корень `nowhere/**` не находит файлов',
    ]);
  });

  test('Корень и Место с {…}: исключения перечислением, расширения', () => {
    const codeMd = md(
      [
        '### C-DEBT-40: тесты на временном каталоге',
        '- **Место:** `modules/wish/src/**/*.{uc,er,job}.test.ts`',
        '- **Признак:** `mkdtemp`',
        '- **Корень:** `{modules,platform}/*/src/**/*.{uc,er,job}.test.ts`',
        '- **Погашает:** трек `cleanup`',
      ].join('\n'),
    );
    const code = [
      file('modules/wish/src/wish/uc/a.uc.test.ts', 'mkdtemp'),
      file('modules/peer-review/src/b.er.test.ts', 'mkdtemp'),
      file('platform/core/src/c.job.test.ts', 'mkdtemp'),
      file('modules/peer-review/src/d.repo.test.ts', 'mkdtemp'),
      file('runners/bot/src/e.uc.test.ts', 'mkdtemp'),
    ];
    expect(run(code, codeMd)).toEqual([
      'ARC-12: C-DEBT-40: долг без записи — modules/peer-review/src/b.er.test.ts:1',
      'ARC-12: C-DEBT-40: долг без записи — platform/core/src/c.job.test.ts:1',
    ]);
  });

  test('без Корня — ищется по всем файлам проверки', () => {
    const code = [...CODE, file('modules/user/src/b.ts', ISO)];
    expect(run(code)).toEqual([
      'ARC-12: C-DEBT-5: долг без записи — modules/user/src/b.ts:2',
    ]);
  });

  test('импорт вне Места — долг без записи', () => {
    const codeMd = md(
      [
        '### C-DEBT-2: импорт `legacy-kit` в домене',
        '- **Место:** `domain/src/user/module.ts`',
        "- **Признак:** `from 'legacy-kit`",
        '- **Корень:** `domain/src/**`',
        '- **Погашает:** трек `cleanup`',
      ].join('\n'),
    );
    const code = [
      file('domain/src/user/module.ts', CORE),
      file('domain/src/course/module.ts', CORE),
    ];
    expect(run(code, codeMd)).toEqual([
      'ARC-12: C-DEBT-2: долг без записи — domain/src/course/module.ts:1',
    ]);
  });
});

describe('DebtChecker: ID долга в коде', () => {
  const bare = (text: string) => [...CODE, file('modules/user/src/c.ts', text)];

  test('голый маркер — ошибка', () => {
    expect(run(bare('// C-DEBT-1\nexport {};'))).toEqual([
      'ARC-12: modules/user/src/c.ts:1: C-DEBT-1 вне biome-ignore',
    ]);
  });

  test('упоминание в JSDoc — ошибка', () => {
    expect(run(bare('/**\n * Вход; свести — C-DEBT-1.\n */'))).toEqual([
      'ARC-12: modules/user/src/c.ts:2: C-DEBT-1 вне biome-ignore',
    ]);
  });

  test('biome-ignore с ID записи — без нарушений', () => {
    expect(run(bare('// biome-ignore lint/plugin: C-DEBT-5 — дата'))).toEqual(
      [],
    );
  });

  test('ID не в реестре — нет записи', () => {
    expect(run(bare('// biome-ignore lint/plugin: C-DEBT-99 — x'))).toEqual([
      `ARC-12: modules/user/src/c.ts:1: C-DEBT-99 — нет записи в ${CODE_MD}`,
    ]);
  });

  test('голый DEBT-n при idPrefix C-DEBT — нет записи', () => {
    expect(run(bare('// DEBT-1: причина'))).toEqual([
      `ARC-12: modules/user/src/c.ts:1: DEBT-1 — нет записи в ${CODE_MD}`,
    ]);
  });

  test('ID чужих реестров (T-DEBT-n, D-DEBT-n) в коде — пропускается', () => {
    expect(run(bare('// см. T-DEBT-3 и D-DEBT-2'))).toEqual([]);
  });

  test('старый формат D-<n> не считается маркером', () => {
    expect(run(bare('// D-1: причина'))).toEqual([]);
  });

  test('idPrefix DEBT: biome-ignore с DEBT-n из реестра — без нарушений, C-DEBT-n — чужой, пропускается', () => {
    const debtMd = registry(
      'DEBT-1',
      [
        '### DEBT-1: исключение линтера',
        '- **Место:** `src/a.ts`',
        '- **Признак:** `as never`',
        '- **Триггер:** второй потребитель',
      ].join('\n'),
    );
    const code = [
      file(
        'src/a.ts',
        '// biome-ignore lint/plugin: DEBT-1 — x\nconst a = b as never;\n// C-DEBT-1 проекта',
      ),
    ];
    const pkg = new DebtChecker({
      idPrefix: 'DEBT',
      registryPaths: { code: 'debt.md' },
    });
    expect(pkg.report(input(code, { code: debtMd }))).toEqual([]);
  });
});

describe('DebtChecker: владелец записи и шапка реестра', () => {
  test('запись без Погашает и Триггер — ошибка', () => {
    const codeMd = md(DEBT_5.replace(/\n- \*\*Триггер:\*\*.*/, ''));
    expect(run(CODE.slice(2), codeMd)).toEqual([
      'ARC-12: C-DEBT-5: нет поля Погашает или Триггер',
    ]);
  });

  test('запись с Погашает и Триггер сразу — ошибка', () => {
    const codeMd = md(`${DEBT_5}\n- **Погашает:** трек \`cleanup\``);
    expect(run(CODE.slice(2), codeMd)).toEqual([
      'ARC-12: C-DEBT-5: оба поля Погашает и Триггер — нужно одно',
    ]);
  });

  test('нет строки «Последний выданный ID» — ошибка', () => {
    expect(run(CODE.slice(2), registry(undefined, DEBT_5))).toEqual([
      `ARC-12: ${CODE_MD}: нет строки «Последний выданный ID»`,
    ]);
  });

  test('«Последний выданный ID» меньше максимального ID реестра — ошибка', () => {
    expect(run(CODE, registry('C-DEBT-3', DEBT_1, DEBT_5))).toEqual([
      `ARC-12: ${CODE_MD}: «Последний выданный ID» C-DEBT-3 меньше максимального C-DEBT-5`,
    ]);
  });

  test('«Последний выданный ID» равен максимальному — без нарушений', () => {
    expect(run(CODE, registry('C-DEBT-5', DEBT_1, DEBT_5))).toEqual([]);
  });

  test('строка «Последний выданный ID» только внутри ``` — нет строки', () => {
    const fenced = '```\n**Последний выданный ID:** C-DEBT-50\n```';
    expect(run(CODE.slice(2), registry(undefined, fenced, DEBT_5))).toEqual([
      `ARC-12: ${CODE_MD}: нет строки «Последний выданный ID»`,
    ]);
  });

  test('«Последний выданный ID» с чужим префиксом — неверный префикс', () => {
    expect(run(CODE.slice(2), registry('D-DEBT-3', DEBT_5))).toEqual([
      `ARC-12: ${CODE_MD}: «Последний выданный ID» D-DEBT-3 — неверный префикс, нужен C-DEBT-<n>`,
    ]);
  });

  test('повтор поля в записи — ошибка', () => {
    const codeMd = md(`${DEBT_5}\n- **Место:** \`nowhere/**\``);
    expect(run(CODE.slice(2), codeMd)).toEqual([
      'ARC-12: C-DEBT-5: поле Место повторено',
    ]);
  });

  test('пустой реестр и код без маркеров — нарушений нет', () => {
    const code = [file('src/a.ts', 'export const a = 1;')];
    expect(checker().check(input(code, { code: md() }))).toEqual([]);
  });
});

describe('DebtChecker: долг тестов T-DEBT', () => {
  const T_1 = [
    '### T-DEBT-1: одно правило двумя тестами',
    '- **Файлы:** `modules/user/src/*.policy.test.ts`, `docs/a.md` — имена тестов',
    '- **Дублирует:** правило `isSelf`',
    '- **Решение:** свести',
    '- **Погашает:** трек `cleanup`',
  ].join('\n');
  const FILES = ['modules/user/src/user.policy.test.ts', 'docs/a.md'];
  const runTests = (entries: string[], files = FILES) =>
    checker().report(
      input([], { code: md(), tests: registry('T-DEBT-7', ...entries) }, files),
    );

  test('каждый glob Файлы находит путь репо — без нарушений', () => {
    expect(runTests([T_1])).toEqual([]);
  });

  test('glob Файлы на несуществующий файл — ошибка', () => {
    expect(runTests([T_1], FILES.slice(0, 1))).toEqual([
      'ARC-12: T-DEBT-1: Файлы `docs/a.md` не находит файлов — случай почищен или файл переехал',
    ]);
  });

  test('запись без Погашает и Триггер — ошибка', () => {
    expect(runTests([T_1.replace(/\n- \*\*Погашает:\*\*.*/, '')])).toEqual([
      'ARC-12: T-DEBT-1: нет поля Погашает или Триггер',
    ]);
  });

  test('повторный заголовок записи — дубль', () => {
    expect(runTests([T_1, T_1])).toEqual(['ARC-12: T-DEBT-1: дубль записи']);
  });
});

describe('DebtChecker: пробелы продукта D-DEBT', () => {
  const D_2 = [
    '### D-DEBT-2: нет гейта совместимости',
    '- **Суть:** ломающее изменение контракта не останавливается',
    '- **Причина:** бот и бэкенд выкатываются вместе',
    '- **Триггер:** первый клиент с отдельной выкаткой',
    '- **Критерий снятия:** `check` отвергает ломающее изменение',
  ].join('\n');
  const runProduct = (entry: string) =>
    checker().report(
      input([], { code: md(), product: registry('D-DEBT-3', entry) }),
    );

  test('поля Суть, Причина, Критерий снятия и Триггер — без нарушений', () => {
    expect(runProduct(D_2)).toEqual([]);
  });

  test.each(['Суть', 'Причина', 'Критерий снятия'])(
    'нет поля %s — ошибка',
    (field) => {
      const entry = D_2.replace(new RegExp(`\\n- \\*\\*${field}:\\*\\*.*`), '');
      expect(runProduct(entry)).toEqual([
        `ARC-12: D-DEBT-2: нет поля ${field}`,
      ]);
    },
  );

  test('Погашает и Триггер сразу — ошибка', () => {
    expect(runProduct(`${D_2}\n- **Погашает:** трек \`web-ui\``)).toEqual([
      'ARC-12: D-DEBT-2: оба поля Погашает и Триггер — нужно одно',
    ]);
  });

  test('ни Погашает, ни Триггер — ошибка', () => {
    expect(runProduct(D_2.replace(/\n- \*\*Триггер:\*\*.*/, ''))).toEqual([
      'ARC-12: D-DEBT-2: нет поля Погашает или Триггер',
    ]);
  });
});

describe('DebtChecker: маркеры временности вне Места записи', () => {
  const ENTRY = [
    '### C-DEBT-1: импорты `legacy-kit`',
    '- **Место:** `domain/src/user/**`',
    "- **Признак:** `from 'legacy-kit`",
    '- **Погашает:** трек `cleanup`',
  ].join('\n');
  const runTemp = (
    path: string,
    comment: string,
    skip: readonly string[] = ['scripts/**'],
  ) =>
    checker(skip)
      .report(
        input(
          [
            file('domain/src/user/a.ts', CORE),
            file(path, `${CORE}\n${comment}`),
          ],
          { code: md(ENTRY) },
        ),
      )
      .filter((e) => e.includes('маркер'));
  const err = (path: string, line: number, phrase: string) =>
    `ARC-12: ${path}:${line}: маркер временности «${phrase}» вне Места открытой записи — заведи запись в ${CODE_MD} или убери комментарий`;

  test.each([
    ['Временное решение', '// Временное решение: пока так'],
    ['ВРЕМЕННЫЙ', '/** ВРЕМЕННЫЙ адаптер */'],
    ['Уходит с миграцией', '// Уходит с миграцией модуля'],
  ])(
    '«%s» вне Места — ошибка с путём, строкой и подсказкой',
    (phrase, text) => {
      expect(runTemp('modules/user/src/b.ts', text)).toEqual([
        err('modules/user/src/b.ts', 2, phrase),
      ]);
    },
  );

  test('фраза в файле из Места записи — без ошибки', () => {
    expect(runTemp('domain/src/user/b.ts', '// Временное решение')).toEqual([]);
  });

  test('«Временное решение» и «Уходит с миграцией» — без учёта регистра', () => {
    expect(
      runTemp('modules/user/src/b.ts', '// временное РЕШЕНИЕ'),
    ).toHaveLength(1);
    expect(
      runTemp('modules/user/src/b.ts', '// уходит С миграцией'),
    ).toHaveLength(1);
  });

  test('«ВРЕМЕННЫЙ» — только заглавными', () => {
    expect(runTemp('modules/user/src/b.ts', '// временный адаптер')).toEqual(
      [],
    );
  });

  test('маркер в файле из tempMarkers.skip — не нарушение', () => {
    expect(
      runTemp(
        'scripts/x.ts',
        '// Временное решение: ВРЕМЕННЫЙ, уходит с миграцией',
      ),
    ).toEqual([]);
  });

  test('без tempMarkers.skip маркер в scripts/ — нарушение', () => {
    expect(runTemp('scripts/x.ts', '// Временное решение', [])).toEqual([
      err('scripts/x.ts', 2, 'Временное решение'),
    ]);
  });

  test.each([
    '// временные метки',
    '// одновременно с этим',
    '// во временном каталоге',
  ])('без ложных срабатываний: %s', (text) => {
    expect(runTemp('modules/user/src/b.ts', text)).toEqual([]);
  });
});

describe('DebtChecker.read: код и реестры с диска', () => {
  const tmp = useTempDir('debt-checker-');
  const LAYOUT: DebtLayout = {
    code: ['domain/src/**/*.ts'],
    exclude: ['**/*.test.ts'],
    registries: { code: CODE_MD, tests: PATHS.tests },
  };
  const put = (path: string, text: string) => Bun.write(tmp().file(path), text);

  test('code — по glob раскладки без exclude; files — все пути репо, обход — у SourceWalk (node_modules не обходится)', async () => {
    await put(CODE_MD, '# долг кода');
    await put(PATHS.tests, '# долг тестов');
    await put('domain/src/user/a.ts', CORE);
    await put('domain/src/user/a.test.ts', '// тест');
    await put('docs/a.md', '# док');
    await put('node_modules/x/index.ts', CORE);
    const read = await DebtChecker.read(tmp().path, LAYOUT);
    expect(read.code).toEqual([file('domain/src/user/a.ts', CORE)]);
    expect([...read.files].sort()).toEqual([
      CODE_MD,
      PATHS.tests,
      'docs/a.md',
      'domain/src/user/a.test.ts',
      'domain/src/user/a.ts',
    ]);
    expect(read.registries).toEqual({
      code: '# долг кода',
      tests: '# долг тестов',
    });
  });

  test('реестр из раскладки, которого нет на диске, — реестр не найден', async () => {
    await put(CODE_MD, md());
    const layout: DebtLayout = { ...LAYOUT, registries: PATHS };
    const lines = checker().report(await DebtChecker.read(tmp().path, layout));
    expect(lines).toEqual([
      `ARC-12: ${PATHS.tests}: реестр не найден`,
      `ARC-12: ${PATHS.product}: реестр не найден`,
    ]);
  });

  test('нет реестра долга кода — реестр не найден', async () => {
    const layout: DebtLayout = { ...LAYOUT, registries: { code: CODE_MD } };
    const lines = checker().report(await DebtChecker.read(tmp().path, layout));
    expect(lines).toEqual([`ARC-12: ${CODE_MD}: реестр не найден`]);
  });

  test('долг вне Места и неизвестный ID — нарушения; голый маркер — нарушение', async () => {
    const entry = [
      '### C-DEBT-1: импорты `legacy-kit` в домене',
      '- **Место:** `domain/src/user/**`',
      "- **Признак:** `from 'legacy-kit`",
      '- **Корень:** `domain/src/**`',
      '- **Погашает:** трек `cleanup`',
    ].join('\n');
    await put(CODE_MD, md(entry));
    await put('domain/src/user/a.ts', `${CORE}\n// C-DEBT-1\n`);
    await put('domain/src/course/b.ts', `${CORE}\n`);
    await put('domain/src/course/c.ts', '// C-DEBT-9\n');
    const layout: DebtLayout = { ...LAYOUT, registries: { code: CODE_MD } };
    const lines = checker().report(await DebtChecker.read(tmp().path, layout));
    expect([...lines].sort()).toEqual([
      'ARC-12: C-DEBT-1: долг без записи — domain/src/course/b.ts:1',
      `ARC-12: domain/src/course/c.ts:1: C-DEBT-9 — нет записи в ${CODE_MD}`,
      'ARC-12: domain/src/user/a.ts:2: C-DEBT-1 вне biome-ignore',
    ]);
  });
});

describe('DebtChecker: долг самого пакета', () => {
  test('в пакете нарушений нет', async () => {
    const layout: DebtLayout = {
      code: ['src/**/*.ts', 'scripts/**/*.ts'],
      exclude: ['**/*.test.ts'],
      registries: { code: 'debt.md' },
    };
    const pkg = new DebtChecker({
      idPrefix: 'DEBT',
      tempMarkers: { skip: ['scripts/**', 'src/arch/debt-checker*.ts'] },
      registryPaths: { code: 'debt.md' },
    });
    const root = join(import.meta.dir, '../..');
    expect(pkg.report(await DebtChecker.read(root, layout))).toEqual([]);
  });
});
