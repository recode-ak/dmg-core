import { expect, test } from 'bun:test';
import { parseArgs } from '../cli';
import { GenLayout, type GenLayoutSettings } from '../layout';
import { planModulePackage } from './module-package';

const MONOREPO: GenLayoutSettings = {
  domain: 'platform/domain/src/{m}',
  backend: 'backend/{m}/src',
  domainImport: '@acme/domain/{m}',
  package: '@acme/be-{m}',
};

/** Диапазоны зависимостей пакета модуля — как их собирает CLI из пакета. */
const DEPS = { 'dmg-core': '^0.1.0', valibot: '^1.5.0' };

const plan = (
  settings: GenLayoutSettings,
  dependencies?: Record<string, string>,
) =>
  planModulePackage({
    ...parseArgs(['module', 'todo'], new GenLayout(settings, '.')),
    dependencies,
  });
const content = (path: string) =>
  plan(MONOREPO, DEPS).files.find((f) => f.path === path)?.content ?? '';

test('gen.package задан — package.json и tsconfig.json пакета модуля', () => {
  expect(plan(MONOREPO, DEPS)).toEqual({
    files: [
      { path: 'backend/todo/package.json', content: expect.any(String) },
      { path: 'backend/todo/tsconfig.json', content: expect.any(String) },
    ],
    edits: [],
  });
});

test('package.json: вход src/index.ts, test, dmg-core, valibot и пакет домена', () => {
  expect(content('backend/todo/package.json')).toBe(`{
  "name": "@acme/be-todo",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "bun test --pass-with-no-tests"
  },
  "dependencies": {
    "dmg-core": "^0.1.0",
    "valibot": "^1.5.0",
    "@acme/domain": "workspace:*"
  }
}
`);
});

test('tsconfig.json: extends корневого по глубине пакета', () => {
  expect(JSON.parse(content('backend/todo/tsconfig.json'))).toEqual({
    extends: '../../tsconfig.json',
    include: ['src'],
  });
  const deep = plan(
    { ...MONOREPO, backend: 'workspaces/backend/{m}/src' },
    DEPS,
  ).files[1]?.content;
  expect(JSON.parse(deep ?? '')).toMatchObject({
    extends: '../../../tsconfig.json',
  });
});

test('без gen.package — пакета нет', () => {
  expect(plan(GenLayout.defaults)).toEqual({ files: [], edits: [] });
});

test('gen.package без версий зависимостей — дефект вызова', () => {
  expect(() => plan(MONOREPO)).toThrow('нет версии dmg-core');
  expect(() => plan(MONOREPO, { 'dmg-core': '^0.1.0' })).toThrow(
    'нет версии valibot',
  );
});
