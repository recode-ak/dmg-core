import { GenLayout } from '../../gen/layout';
import { toPascal } from '../../gen/naming';
import { LintMap } from './lint-map';
import type {
  ScaffoldLayoutData,
  ScaffoldProfile,
} from './project-scaffold.types';

/** Scope из имени пакета: `@acme/school` → `acme`. */
const SCOPE = /^@([^/]+)\//;

/** Имя пакета без scope: `@acme/school` → `school`. */
const BARE = /^@[^/]+\//;

/**
 * Раскладка профиля каркаса: каталоги домена, kernel, сборки и раннера,
 * спецификаторы импортов между ними, `gen` для `dmg-core.json`, пакеты
 * workspaces и карта линтера. Шаблоны (`AppSources`, `ProjectFiles`)
 * одни на все профили и берут отличия только отсюда.
 */
export class ScaffoldLayout {
  /** Раскладка профиля для проекта `name`; scope пакетов monorepo — из имени. */
  static of(profile: ScaffoldProfile, name: string): ScaffoldLayout {
    const appName = name.replace(BARE, '');
    switch (profile) {
      case 'single':
        return ScaffoldLayout.single(appName);
      case 'monorepo':
        return ScaffoldLayout.monorepo(SCOPE.exec(name)?.[1] ?? name, appName);
    }
  }

  /**
   * Один пакет: оси в `src/` — `platform/{kernel,domain}`, `backend/<m>`,
   * `runners/{assembly,cli}` (как учебное приложение пакета). В `gen` —
   * все ключи осей: проект не зависит от значений по умолчанию.
   */
  private static single(appName: string): ScaffoldLayout {
    const domain = 'src/platform/domain';
    const file = `${domain}/${appName}.app.ts`;
    return new ScaffoldLayout({
      domain,
      kernel: GenLayout.defaultKernel,
      assembly: GenLayout.defaultAssembly,
      runner: 'src/runners/cli',
      include: ['src', 'scripts'],
      gen: {
        ...GenLayout.defaults,
        kernel: GenLayout.defaultKernel,
        assembly: GenLayout.defaultAssembly,
        appDef: file,
      },
      appDef: {
        name: appName,
        constant: `${toPascal(appName)}AppDef`,
        file,
        scriptImport: `../${domain}/${appName}.app`,
        graphFile: `scripts/${appName}.graph.ts`,
      },
      imports: {
        kernel: '../../platform/kernel/app-user',
        app: '../assembly/app',
        appTypes: '../assembly/app.types',
      },
      moduleEntry: 'src/backend/<m>/index.ts',
      rootWorkspace: [],
      packages: [],
      lint: LintMap.single,
    });
  }

  /**
   * Пакеты workspaces `@<scope>/*` (D-106) по осям:
   * `platform/{kernel,domain}`, `backend/<m>` (`@<scope>/be-<m>`, создаёт
   * `gen module`), `runners/*`. Импорт — по имени пакета; зависимость на
   * kernel объявляет тот, кто его импортирует.
   */
  private static monorepo(scope: string, appName: string): ScaffoldLayout {
    const file = `platform/domain/src/${appName}.app.ts`;
    const kernel = `@${scope}/kernel`;
    const domain = `@${scope}/domain`;
    const assembly = `@${scope}/assembly`;
    return new ScaffoldLayout({
      domain: 'platform/domain/src',
      kernel: 'platform/kernel/src',
      assembly: 'runners/assembly/src',
      runner: 'runners/cli/src',
      include: ['platform/*/src', 'backend/*/src', 'runners/*/src', 'scripts'],
      gen: {
        domain: 'platform/domain/src/{m}',
        backend: 'backend/{m}/src',
        kernel: 'platform/kernel/src',
        domainImport: `${domain}/{m}`,
        package: `@${scope}/be-{m}`,
        assembly: 'runners/assembly/src',
        appDef: file,
      },
      appDef: {
        name: appName,
        constant: `${toPascal(appName)}AppDef`,
        file,
        scriptImport: domain,
        graphFile: `scripts/${appName}.graph.ts`,
      },
      imports: { kernel, app: assembly, appTypes: assembly },
      moduleEntry: `@${scope}/be-<m> (backend/<m>/src/index.ts)`,
      workspaces: ['platform/*', 'backend/*', 'runners/*'],
      rootWorkspace: [domain],
      packages: [
        {
          dir: 'platform/kernel',
          name: kernel,
          exports: { '.': './src/index.ts' },
          dependencies: ['dmg-core', 'valibot'],
          workspace: [],
        },
        {
          dir: 'platform/domain',
          name: domain,
          exports: {
            '.': './src/index.ts',
            './*/contract': './src/*/contract.ts',
            './*/testing': './src/*/testing.ts',
            './*': './src/*/index.ts',
          },
          dependencies: ['dmg-core', 'valibot'],
          workspace: [],
        },
        {
          dir: 'runners/assembly',
          name: assembly,
          exports: { '.': './src/index.ts' },
          dependencies: ['dmg-core'],
          workspace: [domain, kernel],
        },
        {
          dir: 'runners/cli',
          name: `@${scope}/cli`,
          dependencies: ['dmg-core', 'valibot'],
          workspace: [domain, assembly],
        },
      ],
      lint: LintMap.monorepo(scope),
    });
  }

  private constructor(readonly data: ScaffoldLayoutData) {}
}
