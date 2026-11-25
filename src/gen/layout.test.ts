import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GenLayout } from './layout';
import { ProjectConfig, ProjectConfigError } from './project-config';

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
  expect(rel.domainDir('todo')).toBe('src/platform/domain/todo');
  expect(rel.backendDir('todo')).toBe('src/backend/todo');
});

test('domainImport задан — спецификатор по шаблону', () => {
  expect(
    new GenLayout(
      { ...GenLayout.defaults, domainImport: '@acme/domain/{m}' },
      '.',
    ).domainImport('stream', 'src/backend/stream/student/uc'),
  ).toBe('@acme/domain/stream');
});

test('domainImport не задан — относительный путь к каталогу домена', () => {
  const rel = new GenLayout(GenLayout.defaults, '/repo');
  expect(rel.domainImport('todo', '/repo/src/backend/todo')).toBe(
    '../../platform/domain/todo',
  );
  expect(rel.domainImport('todo', '/repo/src/backend/todo/task/uc')).toBe(
    '../../../../platform/domain/todo',
  );
});

test('относительный путь внутри каталога начинается с ./', () => {
  const nested = new GenLayout(
    { domain: 'm/{m}/domain', backend: 'm/{m}' },
    '.',
  );
  expect(nested.domainImport('todo', 'm/todo')).toBe('./domain');
});

test('describe — применяемая раскладка одной строкой', () => {
  expect(layout('@acme/domain/{m}').describe()).toBe(
    'Раскладка: домен — packages/domain/src/{m}, реализация — packages/{m}/src, импорт домена — @acme/domain/{m}, сборка — не задана (gen.assembly), kernel — не задан (gen.kernel), манифест приложения — не задан (gen.appDef)',
  );
  expect(new GenLayout(GenLayout.defaults, '.').describe()).toBe(
    'Раскладка: домен — src/platform/domain/{m}, реализация — src/backend/{m}, импорт домена — относительный, сборка — src/runners/assembly, kernel — src/platform/kernel, манифест приложения — не задан (gen.appDef)',
  );
});

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'gen-layout-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const put = (path: string, text: string) => {
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), text);
};

test('read — раскладка из секции gen .dmg/config.json проекта', async () => {
  put(
    '.dmg/config.json',
    JSON.stringify({ instructions: null, gen: { domain: 'd/{m}' } }),
  );
  const read = await GenLayout.read(root);
  expect(read.domainDir('todo')).toBe(join(root, 'd/todo'));
  expect(read.backendDir('todo')).toBe(join(root, 'src/backend/todo'));
});

test('read — без файла или без секции gen значения по умолчанию', async () => {
  expect((await GenLayout.read(root)).domainDir('todo')).toBe(
    join(root, 'src/platform/domain/todo'),
  );
  put('.dmg/config.json', '{}');
  expect((await GenLayout.read(root)).backendDir('todo')).toBe(
    join(root, 'src/backend/todo'),
  );
});

test('read — dmg-core.json: отказ, а не тихая раскладка по умолчанию', async () => {
  put('dmg-core.json', JSON.stringify({ gen: { domain: 'd/{m}' } }));
  const error = await GenLayout.read(root).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ProjectConfigError);
  expect((error as Error).message).toBe(
    'dmg-core.json переименован в .dmg/config.json — перенеси файл',
  );
});

test('read — пробрасывает отказ ProjectConfig, в том числе вне секции gen', async () => {
  put('.dmg/config.json', JSON.stringify({ extra: 1 }));
  await expect(GenLayout.read(root)).rejects.toThrow(
    '.dmg/config.json: неизвестное поле «extra»',
  );
});

test('read — слои из секции layers конфига', async () => {
  put(
    '.dmg/config.json',
    JSON.stringify({ layers: { ui: { dir: 'frontend/{m}/src' } } }),
  );
  expect((await GenLayout.read(root)).layerDirs()).toEqual({
    ui: [join(root, 'frontend/{m}/src')],
  });
});

const MONOREPO = {
  domain: 'domain/src/{m}',
  backend: 'modules/{m}/src',
  domainImport: '@acme/domain/{m}',
  package: '@acme/{m}',
};

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

test('сборка: app.ts и package.json её пакета; appDefFile без gen.appDef', () => {
  const mono = new GenLayout({ ...MONOREPO, assembly: 'app/src' }, '/repo');
  expect(mono.assemblyDir()).toBe('/repo/app/src');
  expect(mono.appDefFile()).toBe(undefined);
  expect(mono.assemblyPackage()).toBe('/repo/app/package.json');
  const single = new GenLayout(
    { ...GenLayout.defaults, assembly: 'src/runners/assembly' },
    '/repo',
  );
  expect(single.assemblyDir()).toBe('/repo/src/runners/assembly');
  expect(single.assemblyPackage()).toBe(undefined);
});

test('сборка не задана: раскладка по умолчанию — src/runners/assembly', () => {
  expect(new GenLayout(GenLayout.defaults, '.').assemblyDir()).toBe(
    'src/runners/assembly',
  );
});

test('сборка не задана при своей раскладке — неизвестна (не угадываем)', () => {
  const custom = new GenLayout({ domain: 'd/{m}', backend: 'p/{m}' }, '.');
  expect(custom.assemblyDir()).toBe(undefined);
  expect(custom.assemblyPackage()).toBe(undefined);
});

test('kernelDir — от корня проекта; не задан — src/platform/kernel при раскладке по умолчанию, иначе неизвестен', () => {
  expect(
    new GenLayout(
      { ...MONOREPO, kernel: 'platform/kernel' },
      '/repo',
    ).kernelDir(),
  ).toBe('/repo/platform/kernel');
  expect(new GenLayout(GenLayout.defaults, '.').kernelDir()).toBe(
    'src/platform/kernel',
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
      { ...GenLayout.defaults, appDef: 'src/platform/domain/acme.app.ts' },
      '.',
    ).describe(),
  ).toBe(
    'Раскладка: домен — src/platform/domain/{m}, реализация — src/backend/{m}, импорт домена — относительный, сборка — src/runners/assembly, kernel — src/platform/kernel, манифест приложения — src/platform/domain/acme.app.ts',
  );
});

test('dirs — каталоги слоёв по умолчанию, абсолютные, {m} сохраняется', () => {
  expect(new GenLayout(GenLayout.defaults, '/repo').dirs()).toEqual({
    kernel: '/repo/src/platform/kernel',
    domain: '/repo/src/platform/domain/{m}',
    backend: '/repo/src/backend/{m}',
    assembly: '/repo/src/runners/assembly',
  });
});

test('dirs — своя раскладка с ключами: значения ключей', () => {
  const custom = new GenLayout(
    {
      domain: 'packages/domain/src/{m}',
      backend: 'packages/{m}/src',
      kernel: 'packages/kernel/src',
      assembly: 'app/src',
    },
    '/repo',
  );
  expect(custom.dirs()).toEqual({
    kernel: '/repo/packages/kernel/src',
    domain: '/repo/packages/domain/src/{m}',
    backend: '/repo/packages/{m}/src',
    assembly: '/repo/app/src',
  });
});

test('dirs — своя раскладка без gen.kernel: отказ', () => {
  const custom = new GenLayout(
    { domain: 'd/{m}', backend: 'b/{m}', assembly: 'app' },
    '/repo',
  );
  expect(() => custom.dirs()).toThrow(
    '.dmg/config.json: gen.kernel не задан — каталог kernel нужен проверке слоёв',
  );
});

test('dirs — своя раскладка без gen.assembly: отказ', () => {
  const custom = new GenLayout(
    { domain: 'd/{m}', backend: 'b/{m}', kernel: 'k' },
    '/repo',
  );
  expect(() => custom.dirs()).toThrow(
    '.dmg/config.json: gen.assembly не задан — каталог assembly нужен проверке слоёв',
  );
});

test('layerDirs — места слоёв абсолютные, {m} сохраняется', () => {
  const layers = new GenLayout(GenLayout.defaults, '/repo', {
    ui: { dir: 'frontend/{m}/src', package: '@acme/fe-{m}' },
    tools: { dir: 'tools' },
    abs: { dir: '/opt/shared' },
  });
  expect(layers.layerDirs()).toEqual({
    ui: ['/repo/frontend/{m}/src'],
    tools: ['/repo/tools'],
    abs: ['/opt/shared'],
  });
});

test('layerDirs — без слоёв пустой объект', () => {
  expect(new GenLayout(GenLayout.defaults, '/repo').layerDirs()).toEqual({});
});

test('from — раскладка из gen и слоёв конфига, от корня проекта', () => {
  const config = ProjectConfig.parse({
    gen: { domain: 'd/{m}', backend: 'b/{m}' },
    layers: { ui: { dir: 'frontend/{m}/src' } },
  });
  const layout = GenLayout.from(config, '/repo');
  expect(layout.domainDir('todo')).toBe('/repo/d/todo');
  expect(layout.backendDir('todo')).toBe('/repo/b/todo');
  expect(layout.layerDirs()).toEqual({ ui: ['/repo/frontend/{m}/src'] });
});
