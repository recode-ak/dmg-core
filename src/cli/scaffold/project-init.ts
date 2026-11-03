import { readFile, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { applyPlan } from '../../gen/apply';
import { GenError } from '../../gen/cli';
import type { PackageSource } from '../package-source';
import { ProjectManifest } from './project-manifest';
import { ProjectScaffold } from './project-scaffold';
import type { InitOptions } from './project-scaffold.types';

/** Файл, который каркас сливает с существующим, а не создаёт. */
const MANIFEST = 'package.json';

/** Пакет, от которого зависят пакеты monorepo. */
const DMG_CORE = 'dmg-core';

/**
 * Каркас в каталог проекта (`dmg-core init --profile`): имя, план
 * `ProjectScaffold`, запись `applyPlan` без перезаписи; `package.json`
 * проекта сливается и пишется последним. Конфликт или коллизия — `GenError`
 * до любой записи. @see src/cli/scaffold/project-init.test.ts
 */
export class ProjectInit {
  /** Подсказка следующего шага после записи каркаса. */
  static readonly next = 'Дальше: bun install, затем bun run check';

  constructor(private readonly pkg: PackageSource) {}

  async run(root: string, options: InitOptions): Promise<string[]> {
    const manifestPath = join(root, MANIFEST);
    const existing = await readFile(manifestPath, 'utf8').catch(
      () => undefined,
    );
    const manifest =
      existing === undefined ? undefined : ProjectManifest.parse(existing);
    const name = options.name ?? manifest?.name() ?? basename(resolve(root));
    const plan = new ProjectScaffold({
      profile: options.profile,
      name,
      pkg: this.pkg,
      root,
    }).plan();

    let merged: string | undefined;
    if (manifest !== undefined) {
      const scaffold = plan.files.find((f) => f.path === manifestPath);
      plan.files = plan.files.filter((f) => f !== scaffold);
      merged =
        scaffold && this.merge(scaffold.content, manifest, root, options);
    }

    const write = !options.dryRun;
    const result = applyPlan(plan, { write });
    if (write && merged !== undefined) {
      await writeFile(manifestPath, merged);
    }
    const lines = [`Каркас ${options.profile}: ${name}`];
    const created = write ? 'Создан' : 'Будет создан';
    for (const path of result.written)
      lines.push(`${created}: ${relative(root, path)}`);
    if (merged !== undefined)
      lines.push(`${write ? 'Дополнен' : 'Будет дополнен'}: ${MANIFEST}`);
    if (!write) lines.push('Это dry-run. Для записи убери --dry-run.');
    return lines;
  }

  /**
   * Слияние с `package.json` проекта; `dmg-core` не из реестра — путь от
   * корня проекта, в monorepo ещё `overrides.dmg-core`, иначе `bun install`
   * ищет пакет в реестре. @see docs/guides/project.md
   */
  private merge(
    scaffold: string,
    manifest: ProjectManifest,
    root: string,
    options: InitOptions,
  ): string | undefined {
    const spec = manifest.localSpec(DMG_CORE);
    if (spec === undefined) return manifest.merge(scaffold);
    const base = resolve(root);
    const portable = ProjectManifest.portable(spec, base);
    if (options.profile !== 'monorepo') {
      return manifest.withSpec(DMG_CORE, portable).merge(scaffold);
    }
    this.overridden(manifest, portable, base);
    return manifest.withSpec(DMG_CORE, portable).merge(
      JSON.stringify({
        ...JSON.parse(scaffold),
        overrides: { [DMG_CORE]: portable },
      }),
    );
  }

  /**
   * `overrides.dmg-core` проекта указывает не на тот пакет, что зависимость
   * корня (после приведения к пути от корня), — `GenError` с подсказкой.
   * Тот же файл (старый абсолютный путь) — не конфликт: `withSpec` заменит.
   */
  private overridden(
    manifest: ProjectManifest,
    portable: string,
    root: string,
  ): void {
    const current = manifest.override(DMG_CORE);
    if (current === undefined) return;
    if (ProjectManifest.portable(current, root) === portable) return;
    throw new GenError(
      `package.json проекта расходится с каркасом, ничего не записано:\n  «overrides.${DMG_CORE}»: ${current} — не тот пакет, что в зависимости ${DMG_CORE}; поправь на «${portable}» или удали`,
    );
  }
}
