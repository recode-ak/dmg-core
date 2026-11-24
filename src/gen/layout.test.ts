import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GenLayout } from './layout';

const layout = (domainImport?: string) =>
  new GenLayout(
    {
      domain: 'packages/domain/src/{m}',
      backend: 'packages/{m}/src',
      domainImport,
    },
    '/repo',
  );

test('каталоги модуля — шаблоны с {m} от корня проекта', () => {
  expect(layout().domainDir('stream')).toBe('/repo/packages/domain/src/stream');
  expect(layout().backendDir('stream')).toBe('/repo/packages/stream/src');
});

test('абсолютный шаблон не зависит от корня', () => {
  const abs = new GenLayout(
    { domain: '/d/{m}', backend: '/p/{m}/src' },
    '/repo',
  );
  expect(abs.domainDir('stream')).toBe('/d/stream');
  expect(abs.backendDir('stream')).toBe('/p/stream/src');
});

test('корень «.» оставляет пути относительными', () => {
  const rel = new GenLayout(GenLayout.defaults, '.');
  expect(rel.domainDir('todo')).toBe('src/domain/todo');
  expect(rel.backendDir('todo')).toBe('src/app/todo');
});

test('domainImport задан — спецификатор по шаблону', () => {
  expect(
    new GenLayout(
      { ...GenLayout.defaults, domainImport: '@acme/domain/{m}' },
      '.',
    ).domainImport('stream', 'src/app/stream/student/uc'),
  ).toBe('@acme/domain/stream');
});

test('domainImport не задан — относительный путь к каталогу домена', () => {
  const rel = new GenLayout(GenLayout.defaults, '/repo');
  expect(rel.domainImport('todo', '/repo/src/app/todo')).toBe(
    '../../domain/todo',
  );
  expect(rel.domainImport('todo', '/repo/src/app/todo/task/uc')).toBe(
    '../../../../domain/todo',
  );
});

test('относительный путь внутри каталога начинается с ./', () => {
  const nested = new GenLayout(
    { domain: 'm/{m}/domain', backend: 'm/{m}' },
    '.',
  );
  expect(nested.domainImport('todo', 'm/todo')).toBe('./domain');
});

test('module — домен и реализация модуля для ArchApp.layout', () => {
  expect(layout().module('stream')).toEqual({
    domain: '/repo/packages/domain/src/stream',
    backend: '/repo/packages/stream/src',
  });
});

test('describe — применяемая раскладка одной строкой', () => {
  expect(layout('@acme/domain/{m}').describe()).toBe(
    'Раскладка: домен — packages/domain/src/{m}, реализация — packages/{m}/src, импорт домена — @acme/domain/{m}, сборка — не задана (gen.assembly), kernel — не задан (gen.kernel), манифест приложения — не задан (gen.appDef)',
  );
  expect(new GenLayout(GenLayout.defaults, '.').describe()).toBe(
    'Раскладка: домен — src/domain/{m}, реализация — src/app/{m}, импорт домена — относительный, сборка — src/app, kernel — src/domain/shared, манифест приложения — не задан (gen.appDef)',
  );
});

test('settingsFrom — шаблоны поверх значений по умолчанию', () => {
  expect(GenLayout.settingsFrom({ backend: 'p/{m}' })).toEqual({
    domain: 'src/domain/{m}',
    backend: 'p/{m}',
  });
});

test('settingsFrom — ошибки с полем', () => {
  const error = (json: unknown) => () => GenLayout.settingsFrom(json);
  expect(error([])).toThrow('dmg-core.json: gen — объект');
  expect(error({ domain: 'src/domain' })).toThrow(
    'dmg-core.json: gen.domain — шаблон пути с {m}',
  );
  expect(error({ backend: 'src/app' })).toThrow(
    'dmg-core.json: gen.backend — шаблон пути с {m}',
  );
  expect(error({ domainImport: 1 })).toThrow(
    'dmg-core.json: gen.domainImport — шаблон с {m}',
  );
  expect(error({ root: '.' })).toThrow(
    'dmg-core.json: неизвестное поле «gen.root»',
  );
});

test('settingsFrom — старые ключи: ошибка с новым именем, раньше неизвестного поля', () => {
  const error = (json: unknown) => () => GenLayout.settingsFrom(json);
  expect(error({ app: 'src/app/{m}' })).toThrow(
    'dmg-core.json: gen.app переименован в gen.backend',
  );
  expect(error({ compositionRoot: 'src/app' })).toThrow(
    'dmg-core.json: gen.compositionRoot переименован в gen.assembly',
  );
  expect(error({ root: '.', app: 'p/{m}' })).toThrow(
    'dmg-core.json: gen.app переименован в gen.backend',
  );
});

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'gen-layout-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test('read — раскладка из секции gen dmg-core.json проекта', async () => {
  writeFileSync(
    join(root, 'dmg-core.json'),
    JSON.stringify({ instructions: null, gen: { domain: 'd/{m}' } }),
  );
  expect((await GenLayout.read(root)).module('todo')).toEqual({
    domain: join(root, 'd/todo'),
    backend: join(root, 'src/app/todo'),
  });
});

test('read — без файла или без секции gen значения по умолчанию', async () => {
  expect((await GenLayout.read(root)).domainDir('todo')).toBe(
    join(root, 'src/domain/todo'),
  );
  writeFileSync(join(root, 'dmg-core.json'), '{}');
  expect((await GenLayout.read(root)).backendDir('todo')).toBe(
    join(root, 'src/app/todo'),
  );
});

test('read — старый ключ в dmg-core.json проекта: ошибка с новым именем', async () => {
  writeFileSync(
    join(root, 'dmg-core.json'),
    JSON.stringify({ gen: { app: 'src/app/{m}' } }),
  );
  await expect(GenLayout.read(root)).rejects.toThrow(
    'dmg-core.json: gen.app переименован в gen.backend',
  );
});

const MONOREPO = {
  domain: 'domain/src/{m}',
  backend: 'modules/{m}/src',
  domainImport: '@acme/domain/{m}',
  package: '@acme/{m}',
};

test('settingsFrom — gen.package: шаблон имени пакета модуля', () => {
  expect(GenLayout.settingsFrom(MONOREPO)).toEqual(MONOREPO);
});

test('settingsFrom — ошибки gen.package', () => {
  const error = (json: unknown) => () => GenLayout.settingsFrom(json);
  expect(error({ ...MONOREPO, package: '@acme/todo' })).toThrow(
    'dmg-core.json: gen.package — шаблон имени пакета с {m}',
  );
  expect(error({ ...MONOREPO, backend: 'modules/{m}' })).toThrow(
    'dmg-core.json: gen.package — gen.backend должен оканчиваться на /src',
  );
  const { domainImport: _, ...noImport } = MONOREPO;
  expect(error(noImport)).toThrow(
    'dmg-core.json: gen.package — нужен gen.domainImport',
  );
});

test('package — пакет модуля над каталогом реализации', () => {
  expect(new GenLayout(MONOREPO, '.').package('todo')).toEqual({
    dir: 'modules/todo',
    name: '@acme/todo',
    domain: '@acme/domain',
    root: '../..',
  });
  expect(new GenLayout(MONOREPO, '/repo').package('todo')).toEqual({
    dir: '/repo/modules/todo',
    name: '@acme/todo',
    domain: '@acme/domain',
    root: '../..',
  });
});

test('package — пакет домена без scope: первый сегмент domainImport', () => {
  const plain = { ...MONOREPO, domainImport: 'domain/{m}', package: '{m}' };
  expect(new GenLayout(plain, '.').package('todo')).toMatchObject({
    name: 'todo',
    domain: 'domain',
  });
});

test('package — без gen.package пакета нет', () => {
  expect(new GenLayout(GenLayout.defaults, '.').package('todo')).toBe(
    undefined,
  );
});

test('describe — с пакетом модуля', () => {
  expect(new GenLayout(MONOREPO, '.').describe()).toBe(
    'Раскладка: домен — domain/src/{m}, реализация — modules/{m}/src, импорт домена — @acme/domain/{m}, пакет модуля — @acme/{m}, сборка — не задана (gen.assembly), kernel — не задан (gen.kernel), манифест приложения — не задан (gen.appDef)',
  );
});

test('settingsFrom — gen.assembly: каталог сборки без {m}', () => {
  expect(GenLayout.settingsFrom({ assembly: 'app/src' }).assembly).toBe(
    'app/src',
  );
  expect(() => GenLayout.settingsFrom({ assembly: 'a/{m}' })).toThrow(
    'dmg-core.json: gen.assembly — путь каталога без {m}',
  );
  expect(() => GenLayout.settingsFrom({ assembly: 1 })).toThrow(
    'dmg-core.json: gen.assembly — путь каталога без {m}',
  );
});

test('settingsFrom — gen.kernel: каталог kernel без {m}', () => {
  expect(GenLayout.settingsFrom({ kernel: 'platform/kernel' }).kernel).toBe(
    'platform/kernel',
  );
  expect(() => GenLayout.settingsFrom({ kernel: 'k/{m}' })).toThrow(
    'dmg-core.json: gen.kernel — путь каталога без {m}',
  );
  expect(() => GenLayout.settingsFrom({ kernel: 1 })).toThrow(
    'dmg-core.json: gen.kernel — путь каталога без {m}',
  );
});

test('сборка: app.ts и package.json её пакета; appDefFile без gen.appDef', () => {
  const mono = new GenLayout({ ...MONOREPO, assembly: 'app/src' }, '/repo');
  expect(mono.assemblyDir()).toBe('/repo/app/src');
  expect(mono.appDefFile()).toBe(undefined);
  expect(mono.assemblyPackage()).toBe('/repo/app/package.json');
  const single = new GenLayout(
    { ...GenLayout.defaults, assembly: 'src/app' },
    '/repo',
  );
  expect(single.assemblyDir()).toBe('/repo/src/app');
  expect(single.assemblyPackage()).toBe(undefined);
});

test('сборка не задана: раскладка по умолчанию — src/app', () => {
  expect(new GenLayout(GenLayout.defaults, '.').assemblyDir()).toBe('src/app');
});

test('сборка не задана при своей раскладке — неизвестна (не угадываем)', () => {
  const custom = new GenLayout({ domain: 'd/{m}', backend: 'p/{m}' }, '.');
  expect(custom.assemblyDir()).toBe(undefined);
  expect(custom.assemblyPackage()).toBe(undefined);
});

test('kernelDir — от корня проекта; не задан — src/domain/shared при раскладке по умолчанию, иначе неизвестен', () => {
  expect(
    new GenLayout(
      { ...MONOREPO, kernel: 'platform/kernel' },
      '/repo',
    ).kernelDir(),
  ).toBe('/repo/platform/kernel');
  expect(new GenLayout(GenLayout.defaults, '.').kernelDir()).toBe(
    'src/domain/shared',
  );
  expect(new GenLayout(MONOREPO, '.').kernelDir()).toBe(undefined);
});

test('describe — сборка и kernel, если заданы', () => {
  expect(
    new GenLayout(
      { ...MONOREPO, assembly: 'app/src', kernel: 'platform/kernel' },
      '.',
    ).describe(),
  ).toBe(
    'Раскладка: домен — domain/src/{m}, реализация — modules/{m}/src, импорт домена — @acme/domain/{m}, пакет модуля — @acme/{m}, сборка — app/src, kernel — platform/kernel, манифест приложения — не задан (gen.appDef)',
  );
});

test('settingsFrom — gen.appDef: путь файла AppDef без {m}', () => {
  expect(
    GenLayout.settingsFrom({ appDef: 'src/domain/acme.app.ts' }).appDef,
  ).toBe('src/domain/acme.app.ts');
  expect(() => GenLayout.settingsFrom({ appDef: 'src/{m}.app.ts' })).toThrow(
    'dmg-core.json: gen.appDef — путь файла без {m}',
  );
  expect(() => GenLayout.settingsFrom({ appDef: 1 })).toThrow(
    'dmg-core.json: gen.appDef — путь файла без {m}',
  );
});

test('appDefFile — файл AppDef от корня проекта; не задан — неизвестен', () => {
  const withApp = new GenLayout(
    { ...MONOREPO, appDef: 'domain/src/school.app.ts' },
    '/repo',
  );
  expect(withApp.appDefFile()).toBe('/repo/domain/src/school.app.ts');
  expect(new GenLayout(GenLayout.defaults, '/repo').appDefFile()).toBe(
    undefined,
  );
});

test('describe — манифест приложения, если задан gen.appDef', () => {
  expect(
    new GenLayout(
      { ...GenLayout.defaults, appDef: 'src/domain/acme.app.ts' },
      '.',
    ).describe(),
  ).toBe(
    'Раскладка: домен — src/domain/{m}, реализация — src/app/{m}, импорт домена — относительный, сборка — src/app, kernel — src/domain/shared, манифест приложения — src/domain/acme.app.ts',
  );
});
