import { describe, expect, it } from 'bun:test';
import { parseArgs } from '../cli';
import { GenLayout } from '../layout';
import { AppWiring, WIRING_MARKERS } from './app-wiring';

type Gen = ConstructorParameters<typeof GenLayout>[0];

const wiring = (gen: Gen, target = 'module stream') =>
  new AppWiring(parseArgs(target.split(' '), new GenLayout(gen, '.')));

const MONO: Gen = {
  domain: '/d/{m}',
  backend: '/p/{m}/src',
  domainImport: '@acme/domain/{m}',
  package: '@acme/{m}',
  assembly: 'app/src',
  appDef: '/d/acme.app.ts',
};
const SINGLE: Gen = {
  ...GenLayout.defaults,
  appDef: 'src/platform/domain/acme.app.ts',
};
const CUSTOM: Gen = {
  domain: '/d/{m}',
  backend: '/p/{m}/src',
  domainImport: '@acme/domain/{m}',
};

describe('AppWiring.moduleEdits', () => {
  it('monorepo: маркеры app.ts и файла AppDef', () => {
    const edits = wiring(MONO).moduleEdits();
    const { imports, modules, repos } = WIRING_MARKERS;
    expect(edits.map((e) => [e.path, e.marker])).toEqual([
      ['app/src/app.ts', imports],
      ['app/src/app.ts', imports],
      ['app/src/app.ts', modules],
      ['/d/acme.app.ts', imports],
      ['/d/acme.app.ts', modules],
    ]);
    expect(edits[2]?.line).toContain(repos('stream'));
  });

  it('monorepo: AppDef получает импорт Def и элемент состава', () => {
    const edits = wiring(MONO)
      .moduleEdits()
      .filter((e) => e.path === '/d/acme.app.ts');
    expect(edits.map((e) => e.line)).toEqual([
      "import { StreamModuleDef } from './stream/contract';",
      '    StreamModuleDef,',
    ]);
  });

  it('single: правки AppDef — src/platform/domain/acme.app.ts', () => {
    const edits = wiring(SINGLE).moduleEdits();
    expect(
      edits
        .filter((e) => e.path === 'src/platform/domain/acme.app.ts')
        .map((e) => e.marker),
    ).toEqual([WIRING_MARKERS.imports, WIRING_MARKERS.modules]);
  });

  it('своя раскладка без assembly, но с appDef — только правки AppDef', () => {
    const edits = wiring({ ...CUSTOM, appDef: '/d/acme.app.ts' }).moduleEdits();
    expect(edits.map((e) => [e.path, e.marker])).toEqual([
      ['/d/acme.app.ts', WIRING_MARKERS.imports],
      ['/d/acme.app.ts', WIRING_MARKERS.modules],
    ]);
  });

  it('assembly без appDef — только правки app.ts', () => {
    const { appDef: _, ...noApp } = MONO;
    const edits = wiring(noApp).moduleEdits();
    expect(new Set(edits.map((e) => e.path))).toEqual(
      new Set(['app/src/app.ts']),
    );
  });

  it('monorepo: фабрика импортируется из пакета модуля', () => {
    const lines = wiring(MONO)
      .moduleEdits()
      .map((e) => e.line);
    expect(lines).toContain(
      "import { createStreamModule } from '@acme/stream';",
    );
  });

  it('single: импорты относительные, сборка — src/runners/assembly', () => {
    const edits = wiring(SINGLE).moduleEdits();
    expect(edits.map((e) => e.path)).toContain('src/runners/assembly/app.ts');
    expect(edits.map((e) => e.line)).toContain(
      "import { createStreamModule } from '../../backend/stream';",
    );
  });

  it('своя раскладка без assembly и appDef — правок нет', () => {
    expect(wiring(CUSTOM).moduleEdits()).toEqual([]);
  });
});

describe('AppWiring.moduleDependencies', () => {
  it('с gen.package — зависимость пакета корня сборки', () => {
    expect(wiring(MONO).moduleDependencies()).toEqual([
      {
        path: 'app/package.json',
        name: '@acme/stream',
        version: 'workspace:*',
      },
    ]);
  });

  it('без gen.package — зависимостей нет', () => {
    expect(wiring(SINGLE).moduleDependencies()).toEqual([]);
  });
});

describe('AppWiring.moduleNotes', () => {
  it('monorepo: напоминание bun install', () => {
    const notes = wiring(MONO).moduleNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('bun install');
  });

  it('без gen.package: подсказок нет', () => {
    expect(wiring(SINGLE).moduleNotes()).toEqual([]);
  });

  it('без appDef — подсказка про gen.appDef с Def и контрактом', () => {
    const { appDef: _, ...noApp } = MONO;
    const notes = wiring(noApp).moduleNotes();
    expect(notes.join('\n')).toContain(
      'Вставь вручную в манифест приложения (gen.appDef в .dmg/config.json), modules: StreamModuleDef (из',
    );
    expect(notes.join('\n')).toContain('@acme/domain/stream/contract');
  });

  it('appDef задан — подсказки про манифест нет', () => {
    expect(wiring(MONO).moduleNotes().join('\n')).not.toContain('gen.appDef');
  });

  it('без assembly и appDef — общая подсказка называет gen.appDef', () => {
    const notes = wiring(CUSTOM).moduleNotes().join('\n');
    expect(notes).toContain('gen.assembly');
    expect(notes).toContain(
      'манифест приложения (gen.appDef в .dmg/config.json), modules: StreamModuleDef',
    );
  });

  it('без assembly — подсказка без правок: элемент списка, вход пакета, контракт', () => {
    const w = wiring({ ...CUSTOM, package: '@acme/{m}' });
    expect(w.moduleDependencies()).toEqual([]);
    const notes = w.moduleNotes();
    expect(notes[0]).toContain('gen.assembly');
    expect(notes.join('\n')).toContain(
      '{ def: StreamModuleDef, create: (deps) => createStreamModule({ ...deps }) }',
    );
    expect(notes.join('\n')).toContain(
      "createStreamModule — из входа '@acme/stream', StreamModuleDef — из '@acme/domain/stream/contract'",
    );
    expect(notes.join('\n')).toContain('"@acme/stream": "workspace:*"');
    expect(notes.at(-1)).toContain('bun install');
  });

  it('корень сборки не на /src — зависимость вручную с каталогом', () => {
    const w = wiring({ ...MONO, assembly: 'app' });
    expect(w.moduleDependencies()).toEqual([]);
    const notes = w.moduleNotes();
    expect(notes[0]).toBe(
      'Вставь вручную в package.json пакета с каталогом app, dependencies: "@acme/stream": "workspace:*"',
    );
    expect(notes.at(-1)).toContain('bun install');
  });
});

describe('AppWiring.aggregateEdits', () => {
  it('импорт и репозиторий — одна группа с маркерами app.ts', () => {
    const edits = wiring(MONO, 'aggregate stream.student').aggregateEdits(
      'student',
    );
    expect(edits.map((e) => e.marker)).toEqual([
      WIRING_MARKERS.imports,
      WIRING_MARKERS.repos('stream'),
    ]);
    expect(new Set(edits.map((e) => e.group))).toEqual(
      new Set(['repo:stream.student']),
    );
    expect(edits[1]?.line).toContain(
      "join(env.dataDir, 'stream.student.json')",
    );
  });

  it('без assembly — правок нет', () => {
    const w = wiring(CUSTOM, 'aggregate stream.student');
    expect(w.aggregateEdits('student')).toEqual([]);
  });
});
