import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Фикстура-поставщик пакета (каталог `src/testing/example-provider`) */
export const EXAMPLE_PROVIDER = join(
  import.meta.dir,
  '../testing/example-provider',
);

/** Записывает файлы (путь относительно base → текст), создавая каталоги */
export async function put(base: string, files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(base, path)), { recursive: true });
    await writeFile(join(base, path), text);
  }
}

/** Текст роли: frontmatter и промпт */
export function role(name: string): string {
  return `---\nname: ${name}\ndescription: Роль ${name}\ntools: [read, bash]\n---\n\nПромпт ${name}.\n`;
}

/** Файлы скила `skills/<name>/SKILL.md` для `put` */
export function skill(name: string): Record<string, string> {
  return {
    [`skills/${name}/SKILL.md`]: `---\nname: ${name}\ndescription: d\n---\n\nСкил ${name}.\n`,
  };
}

/**
 * Пакет-поставщик в `node_modules` проекта project. Собирать `node_modules`
 * нужно до первого поиска: промах `Bun.resolveSync` кэшируется на процесс.
 */
export async function installProvider(
  project: string,
  name: string,
  files: Record<string, string> = {},
  version = '0.1.0',
) {
  await put(join(project, 'node_modules', name), {
    'package.json': JSON.stringify({
      name,
      version,
      type: 'module',
      exports: { './dmg-core': './dmg-core.ts' },
    }),
    'dmg-core.ts': 'export {};\n',
    ...files,
  });
}

/** Фикстура-поставщик — симлинком в `node_modules` проекта */
export async function linkExampleProvider(project: string) {
  await mkdir(join(project, 'node_modules'), { recursive: true });
  await symlink(
    EXAMPLE_PROVIDER,
    join(project, 'node_modules/example-provider'),
  );
}
