import { LINE_WIDTH, sortImports } from '../../gen/import-order';
import { PACKAGE_TEST } from '../../gen/kinds/module-package';
import { ProjectConfig } from '../../gen/project-config';
import { CliConfig } from '../cli-config';
import type { Dependencies, PackageSource } from '../package-source';
import type {
  ScaffoldFile,
  ScaffoldLayoutData,
  ScaffoldPackage,
} from './project-scaffold.types';
import type { ScaffoldLayout } from './scaffold-layout';

/** Зависимости проекта из `peerDependencies` пакета (кроме самого dmg-core). */
const PEERS = ['valibot', '@valibot/to-json-schema'];

/** Версия проекта по умолчанию: `dmg-core graph` берёт её из `package.json`. */
const INITIAL_VERSION = '0.1.0';

/** Инструменты `check` проекта из `devDependencies` пакета. */
const TOOLS = ['@biomejs/biome', 'typescript', '@types/bun'];

/**
 * Конфиги проекта от корня: `.gitignore`, `package.json` (у monorepo —
 * workspaces), `tsconfig.json`, `biome.json`, `.dmg/config.json`, скрипты
 * `scripts/arch-check.ts` и `scripts/<имя>.graph.ts` (вход `dmg-core graph`);
 * у пакетов workspaces — свои `package.json` и `tsconfig.json`.
 */
export class ProjectFiles {
  private readonly layout: ScaffoldLayoutData;

  constructor(
    private readonly name: string,
    private readonly pkg: PackageSource,
    layout: ScaffoldLayout,
  ) {
    this.layout = layout.data;
  }

  files(): ScaffoldFile[] {
    return [
      ...this.root(),
      ...this.layout.packages.flatMap((p) => this.packageFiles(p)),
    ];
  }

  private root(): ScaffoldFile[] {
    return [
      {
        path: '.gitignore',
        content: `node_modules/\ndata/\n${ProjectConfig.graphFile}\n`,
      },
      { path: 'package.json', content: this.manifest(this.packageJson()) },
      { path: 'tsconfig.json', content: this.json(this.tsconfig()) },
      { path: 'biome.json', content: this.json(this.biome()) },
      {
        path: ProjectConfig.file,
        content: this.json({
          ...new CliConfig(this.pkg).defaults(),
          gen: this.layout.gen,
        }),
      },
      { path: 'scripts/arch-check.ts', content: this.archCheck() },
      { path: this.layout.appDef.graphFile, content: this.graphEntry() },
    ];
  }

  private packageFiles(p: ScaffoldPackage): ScaffoldFile[] {
    const up = p.dir
      .split('/')
      .map(() => '..')
      .join('/');
    const workspace = this.workspace(p.workspace);
    const manifest = {
      name: p.name,
      private: true,
      type: 'module',
      ...(p.exports === undefined ? {} : { exports: p.exports }),
      scripts: { test: PACKAGE_TEST },
      dependencies: { ...this.dependencies(p.dependencies), ...workspace },
    };
    return [
      { path: `${p.dir}/package.json`, content: this.manifest(manifest) },
      {
        path: `${p.dir}/tsconfig.json`,
        content: this.json({
          extends: `${up}/tsconfig.json`,
          include: ['src'],
        }),
      },
    ];
  }

  /** Зависимости на пакеты workspaces: версия `workspace:*`. */
  private workspace(names: readonly string[]): Record<string, string> {
    const workspace: Record<string, string> = {};
    for (const name of names) workspace[name] = 'workspace:*';
    return workspace;
  }

  /** Версии внешних зависимостей: dmg-core — версия пакета, прочие — его peer. */
  private dependencies(names: readonly string[]): Record<string, string> {
    const peers = names.filter((name) => name !== 'dmg-core');
    return {
      ...(names.includes('dmg-core')
        ? { 'dmg-core': `^${this.pkg.version}` }
        : {}),
      ...this.versions(this.pkg.peerDependencies, peers, 'peerDependencies'),
    };
  }

  private packageJson(): object {
    const dependencies = this.dependencies(['dmg-core', ...PEERS]);
    const tools = this.versions(
      this.pkg.devDependencies,
      TOOLS,
      'devDependencies',
    );
    // Корень workspaces ничего не исполняет сам: dmg-core (бинарь
    // `dmg-core sync`, плагины biome, `arch:check`) с его peer-зависимостями
    // и инструменты check — dev, как и пакеты workspaces, которые корень
    // импортирует (`rootWorkspace`); пакеты объявляют свои зависимости сами.
    const workspaces = this.layout.workspaces;
    return {
      name: this.name,
      version: INITIAL_VERSION,
      private: true,
      type: 'module',
      ...(workspaces === undefined ? {} : { workspaces }),
      scripts: {
        'arch:check': 'bun scripts/arch-check.ts',
        graph: `dmg-core graph ${this.layout.appDef.graphFile}`,
        check:
          'dmg-core sync --check && biome check . && tsc --noEmit && bun run arch:check && bun test',
        lint: 'biome check .',
        format: 'biome check . --write',
      },
      ...(workspaces === undefined
        ? { dependencies, devDependencies: tools }
        : {
            devDependencies: {
              ...dependencies,
              ...tools,
              ...this.workspace(this.layout.rootWorkspace),
            },
          }),
    };
  }

  /** Версии `names` из секции пакета; нет версии — дефект поставки пакета. */
  private versions(
    from: Dependencies,
    names: readonly string[],
    section: string,
  ): Record<string, string> {
    const versions: Record<string, string> = {};
    for (const name of names) {
      const version = from[name];
      if (version === undefined) {
        throw new Error(`В ${section} пакета dmg-core нет версии ${name}`);
      }
      versions[name] = version;
    }
    return versions;
  }

  private tsconfig(): object {
    return {
      compilerOptions: {
        lib: ['ESNext'],
        target: 'ESNext',
        module: 'Preserve',
        moduleDetection: 'force',
        moduleResolution: 'bundler',
        allowImportingTsExtensions: true,
        verbatimModuleSyntax: true,
        noEmit: true,
        strict: true,
        skipLibCheck: true,
        noFallthroughCasesInSwitch: true,
        noUncheckedIndexedAccess: true,
        noImplicitOverride: true,
        types: ['bun'],
      },
      include: this.layout.include,
    };
  }

  private biome(): object {
    const version = this.pkg.devDependencies['@biomejs/biome'];
    return {
      $schema: `https://biomejs.dev/schemas/${version}/schema.json`,
      root: true,
      vcs: { enabled: false },
      // Каталог данных (`APP_DATA_DIR=data`, как в `.gitignore`) пишет
      // приложение — не исходники проекта.
      files: { ignoreUnknown: true, includes: ['**', '!!data'] },
      formatter: { enabled: true, indentStyle: 'space', indentWidth: 2 },
      linter: { enabled: true, rules: { preset: 'recommended' } },
      javascript: { formatter: { quoteStyle: 'single' } },
      assist: {
        enabled: true,
        actions: { source: { organizeImports: 'on' } },
      },
      overrides: [
        {
          includes: ['**/*.test.ts'],
          linter: {
            rules: {
              correctness: { noUnusedVariables: 'off' },
              suspicious: {
                noExplicitAny: 'off',
                noNonNullAssertedOptionalChain: 'off',
              },
              style: { noNonNullAssertion: 'off' },
            },
          },
        },
        ...this.layout.lint.overrides(),
      ],
    };
  }

  private archCheck(): string {
    const { runner, appDef } = this.layout;
    const graph = `${appDef.constant.replace(/AppDef$/, '')}Graph`;
    // Порядок biome: пакеты раньше относительных путей.
    const imports = sortImports([
      "import { join } from 'node:path';",
      "import { type ArchApp, reportArchCheck } from 'dmg-core/arch';",
      "import { GenLayout } from 'dmg-core/gen';",
      `import ${graph} from './${appDef.name}.graph';`,
    ]);
    return `/**
 * \`bun run arch:check\` — контрактные проверки архитектуры (\`ArchChecker\`):
 * состав приложения (\`AppDef\`, поставщики с правилами и слоями) — из входа
 * графа \`${appDef.name}.graph.ts\`, каталоги слоёв — из \`.dmg/config.json\`
 * (\`GenLayout.dirs()\`, \`layerDirs()\`), раннеры-процессы — списком; файл
 * входа графа (\`graphEntry\`) — его замыкание импортов не доходит до
 * реализаций (ARC-16).
 * Выход 1 — есть нарушения. \`--strict\` — незаполненные \`TODO\` в описаниях
 * Def тоже нарушения (MAN-01).
 */
${imports}

const root = join(import.meta.dir, '..');
const layout = await GenLayout.read(root);

const app: ArchApp = {
  ...${graph},
  entry: 'contract',
  project: root,
  layout: layout.dirs(),
  layers: layout.layerDirs(),
  runners: [join(root, '${runner}')],
  graphEntry: join(root, '${appDef.graphFile}'),
};

// Незаполненные TODO в Def — предупреждения; --strict делает их нарушениями.
process.exitCode = reportArchCheck([app], (line) => console.log(line), {
  strict: process.argv.includes('--strict'),
});
`;
  }

  /** Вход `dmg-core graph` (D-96): `AppDef` и поставщики сверх домена. */
  private graphEntry(): string {
    const { appDef } = this.layout;
    // Порядок biome: пакет `dmg-core` раньше `@scope/domain`, путь `../` — позже.
    const imports = sortImports([
      "import type { GraphApp } from 'dmg-core/graph';",
      `import { ${appDef.constant} } from '${appDef.scriptImport}';`,
    ]);
    return `/**
 * Вход \`dmg-core graph\` (\`bun run graph\`): документ графа приложения
 * \`.dmg/graph.json\`. Поставщиков графа сверх домена добавляй в \`providers\`.
 */
${imports}

export default { def: ${appDef.constant} } satisfies GraphApp;
`;
  }

  /**
   * JSON в форме biome: объекты раскрыты, массив простых значений —
   * в одну строку, если она укладывается в ширину строки форматтера.
   */
  private json(data: object): string {
    return this.manifest(data).replace(
      /^(.*)\[\n([^[\]{}]*?)\n\s*\](,?)$/gm,
      (whole, head: string, items: string, comma: string) => {
        const values = items.split('\n').map((item) => item.trim());
        const line = `${head}[${values.join(' ')}]${comma}`;
        return line.length <= LINE_WIDTH ? line : whole;
      },
    );
  }

  /** `package.json` в форме biome: массивы всегда раскрыты (как у npm). */
  private manifest(data: object): string {
    return `${JSON.stringify(data, null, 2)}\n`;
  }
}
