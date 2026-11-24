/** Секции зависимостей `package.json` фикстуры `Monorepo`. */
export type FixtureSection =
  | 'dependencies'
  | 'devDependencies'
  | 'peerDependencies'
  | 'optionalDependencies';

/** `package.json` фикстуры; зависимости — имена: vendor → `file:`, иначе `workspace:*`. */
export type FixtureManifest = {
  readonly name?: string;
  readonly exports?: Readonly<Record<string, string>>;
  readonly imports?: Readonly<Record<string, string>>;
  readonly workspaces?:
    | readonly string[]
    | { readonly packages: readonly string[] };
} & { readonly [S in FixtureSection]?: readonly string[] };
