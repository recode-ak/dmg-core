import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { join, relative } from 'node:path';
import { Monorepo } from './monorepo.fixture';
import { UnitMap } from './unit-map';
import type { Unit } from './unit-map.types';

// Список единиц читается из файлов, без установки: `package.json` корня
// (`workspaces`) и пакетов. Единица — `<каталог от проекта> <name>`.
let repo: Monorepo;

beforeEach(() => {
  repo = Monorepo.create();
});

afterEach(() => {
  repo.dispose();
});

const units = (): string[] =>
  UnitMap.read(repo.proj)
    .units.map((u: Unit) => `${relative(repo.proj, u.dir)} ${u.name}`)
    .sort();

/** Пакеты `platform/kernel`, `backend/alpha` и `tools/gen` (вне шаблонов ниже). */
function packages(): void {
  repo
    .unit('platform/kernel', { name: '@t/kernel' })
    .unit('backend/alpha', { name: '@t/be-alpha' })
    .unit('tools/gen', { name: '@t/gen' });
}

describe('UnitMap.read', () => {
  it('workspaces массивом — пакеты по шаблонам глоба', () => {
    packages();
    repo.root({ workspaces: ['platform/*', 'backend/*'] });
    expect(units()).toEqual([
      'backend/alpha @t/be-alpha',
      'platform/kernel @t/kernel',
    ]);
  });

  it('workspaces объектом { packages }', () => {
    packages();
    repo.root({ workspaces: { packages: ['platform/*', 'backend/*'] } });
    expect(units()).toEqual([
      'backend/alpha @t/be-alpha',
      'platform/kernel @t/kernel',
    ]);
  });

  it('!шаблон исключает пакет', () => {
    packages();
    repo
      .unit('backend/legacy', { name: '@t/legacy' })
      .root({ workspaces: ['platform/*', 'backend/*', '!backend/legacy'] });
    expect(units()).toEqual([
      'backend/alpha @t/be-alpha',
      'platform/kernel @t/kernel',
    ]);
  });

  it('пакет в node_modules — не единица, даже если шаблон его захватывает', () => {
    repo
      .unit('packages/alpha', { name: '@t/alpha' })
      .unit('packages/alpha/node_modules/dep', { name: 'dep' })
      .root({ workspaces: ['packages/**'] });
    expect(units()).toEqual(['packages/alpha @t/alpha']);
  });

  it('working — dependencies и peerDependencies, dev — devDependencies; optionalDependencies не учитываются', () => {
    repo
      .unit('backend/alpha', {
        name: '@t/be-alpha',
        dependencies: ['@t/domain', 'ext-a'],
        peerDependencies: ['ext-peer'],
        devDependencies: ['ext-dev'],
        optionalDependencies: ['ext-opt'],
      })
      .root({ workspaces: ['backend/*'] });
    const unit = UnitMap.read(repo.proj).named('@t/be-alpha');
    expect(unit && [[...unit.working].sort(), [...unit.dev].sort()]).toEqual([
      ['@t/domain', 'ext-a', 'ext-peer'],
      ['ext-dev'],
    ]);
  });

  it('unitOf — самый глубокий каталог единицы; путь вне единиц — undefined', () => {
    repo
      .unit('packages/outer', { name: '@t/outer' })
      .unit('packages/outer/inner', { name: '@t/inner' })
      .root({ workspaces: ['packages/*', 'packages/outer/*'] });
    const map = UnitMap.read(repo.proj);
    const at = (path: string): string | undefined =>
      map.unitOf(join(repo.proj, path))?.name;
    expect([
      at('packages/outer/inner/src/x.ts'),
      at('packages/outer/src/x.ts'),
      at('packages/outer-other/x.ts'),
      at('scripts/x.ts'),
    ]).toEqual(['@t/inner', '@t/outer', undefined, undefined]);
  });

  it('пакет workspaces без name — отказ', () => {
    repo
      .unit('backend/alpha', { name: '@t/be-alpha' })
      .unit('backend/noname', {})
      .root({ workspaces: ['backend/*'] });
    expect(() => UnitMap.read(repo.proj)).toThrow(
      new Error('backend/noname/package.json пакета workspaces без name'),
    );
  });
});
