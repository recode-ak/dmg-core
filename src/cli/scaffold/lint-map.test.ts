import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LintMap } from './lint-map';

// Целостность таблицы. Срабатывание каждой строки на своих каталогах —
// в project-scaffold.e2e.test.ts (biome на временном каркасе).

const PLUGINS_DIR = join(import.meta.dir, '../../../biome-plugins');

// Строки-плагины `LintMap.of` от каталогов профиля не зависят: хватает single.
describe('LintMap.single', () => {
  it('подключает каждый плагин пакета', () => {
    const plugins = LintMap.single.rules.flatMap((rule) =>
      'plugin' in rule ? [`${rule.plugin}.grit`] : [],
    );

    expect(plugins.sort()).toEqual(readdirSync(PLUGINS_DIR).sort());
  });
});

/** Белый список первой секции ARC-02 строки с этими `includes`. */
function allowed(map: LintMap, includes: string): readonly string[] {
  const rule = map.rules.find(
    (r) => r.id === 'ARC-02' && r.includes.includes(includes),
  );
  if (rule === undefined || !('imports' in rule)) {
    throw new Error(`Нет строки ARC-02 на ${includes}`);
  }
  return rule.imports[0]?.group ?? [];
}

describe('LintMap: ARC-02 kernel приложения', () => {
  const KERNEL_ONLY = [
    '**',
    '!dmg-core',
    '!valibot',
    '!.',
    '!..',
    '!./**',
    '!../**',
  ];

  it('single: строка kernel первой — корень dmg-core, valibot и свои файлы', () => {
    const [first] = LintMap.single.rules;

    expect(first).toEqual({
      id: 'ARC-02',
      includes: ['src/platform/kernel/**'],
      imports: [
        {
          group: KERNEL_ONLY,
          message:
            'ARC-02: kernel приложения импортирует только корень dmg-core (ядро и Def-классы) и valibot',
        },
      ],
    });
  });

  it('monorepo: kernel не видит домен', () => {
    const group = allowed(LintMap.monorepo('acme'), 'platform/kernel/src/**');

    expect(group).toEqual(KERNEL_ONLY);
    expect(group).not.toContain('!@acme/domain');
  });

  it('monorepo: домен видит вход @<scope>/kernel, но не его подпути', () => {
    const group = allowed(LintMap.monorepo('acme'), 'platform/domain/src/**');

    expect(group).toContain('!@acme/kernel');
    expect(group).not.toContain('!@acme/kernel/**');
  });

  it('monorepo: scope из аргумента', () => {
    const group = allowed(LintMap.monorepo('other'), 'platform/domain/src/**');

    expect(group).toContain('!@other/kernel');
    expect(group).not.toContain('!@acme/kernel');
  });

  it('домен: сообщение называет kernel приложения', () => {
    const rule = LintMap.single.rules.find(
      (r) => r.id === 'ARC-02' && r.includes.includes('src/platform/domain/**'),
    );

    expect(rule !== undefined && 'imports' in rule && rule.imports[0]).toEqual({
      group: KERNEL_ONLY,
      message:
        'ARC-02: домен импортирует только корень dmg-core (ядро и Def-классы), valibot и kernel приложения',
    });
  });
});

describe('LintMap: repeats', () => {
  it('ссылка на строку без запрета импортов — исключение', () => {
    const map = new LintMap([
      { id: 'DOM-14', plugin: 'dom-14-no-clock', includes: ['src/**'] },
      {
        id: 'DOM-01',
        includes: ['src/**'],
        imports: [{ group: ['**/state'], message: 'DOM-01: …' }],
        repeats: ['DOM-14'],
      },
    ]);

    expect(() => map.overrides()).toThrow(
      'Карта линтера: DOM-01 повторяет DOM-14 — нет строки с запретом импортов',
    );
  });

  it('повторяет ближайшую строку выше с этим ID', () => {
    const ban = (message: string) => ({ group: ['**/state'], message });
    const map = new LintMap([
      { id: 'DOM-01', includes: ['a/**'], imports: [ban('DOM-01: домен')] },
      {
        id: 'DOM-01',
        includes: ['b/**'],
        imports: [ban('DOM-01: прикладной')],
      },
      {
        id: 'TST-07',
        includes: ['b/**'],
        imports: [{ group: ['**/*.repo.fake'], message: 'TST-07: …' }],
        repeats: ['DOM-01'],
      },
    ]);

    expect(JSON.stringify(map.overrides()[2])).toContain('DOM-01: прикладной');
    expect(JSON.stringify(map.overrides()[2])).not.toContain('DOM-01: домен');
  });
});

// Раздел «Карта линтера» в rules.md пишется по LintMap: каждая строка
// таблицы (ID и плагин) названа в нём.
describe('LintMap: карта в rules.md', () => {
  const rules = readFileSync(
    join(import.meta.dir, '../../../docs/reference/rules.md'),
    'utf8',
  );
  const map = rules.split('## Карта линтера')[1]?.split('\n## ')[0] ?? '';

  it('называет ID и плагин каждой строки', () => {
    const missing = LintMap.single.rules
      .flatMap((rule) =>
        'plugin' in rule ? [rule.id, `${rule.plugin}.grit`] : [rule.id],
      )
      .filter((name) => !map.includes(name));

    expect(missing).toEqual([]);
  });
});
