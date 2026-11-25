import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GenError, PackageDefectError } from '../gen/cli';
import { GenLayout } from '../gen/layout';
import { runGen } from '../gen/main';
import { ProjectConfig, ProjectConfigError } from '../gen/project-config';
import { CliConfig, type CliSettings } from './cli-config';
import { Delivery } from './delivery';
import { InstructionsBlock } from './instructions-block';
import type { PackageSource } from './package-source';
import { InitArgs } from './scaffold/init-args';
import { ProjectInit } from './scaffold/project-init';
import type { InitOptions } from './scaffold/project-scaffold.types';

/** Итог команды: ok — проект согласован с пакетом */
export interface CliResult {
  ok: boolean;
  messages: string[];
}

/** Доставка по настройкам проекта; instructions — файл для вставки */
interface Prepared {
  delivery: Delivery;
  instructions?: string;
}

/** Конфиг проекта и настройки доставки по нему */
interface Loaded {
  config: ProjectConfig;
  settings: CliSettings;
}

/**
 * Команды пакета в проекте (`USAGE` — в `main.ts`): `init` — конфиг и sync,
 * с `--profile` — каркас `ProjectInit`; `sync` — копии скилов, ролей и
 * вставка в инструкции (`--check` — только сверка); `gen` — файлы модуля.
 */
export class DmgCoreCli {
  private readonly block: InstructionsBlock;
  private readonly config: CliConfig;

  constructor(private readonly pkg: PackageSource) {
    this.block = new InstructionsBlock(pkg.version);
    this.config = new CliConfig(pkg);
  }

  /**
   * argv — аргументы после `init`; без `--profile` — прежнее поведение.
   * Конфиг читается до любой записи: `dmg-core.json` — отказ, ничего не записано.
   */
  async init(root: string, argv: readonly string[] = []): Promise<CliResult> {
    let args: InitArgs;
    try {
      args = InitArgs.parse(argv);
    } catch (error) {
      return this.failure(error);
    }
    const found = await this.project(root);
    if (typeof found === 'string') return { ok: false, messages: [found] };
    if (args.profile !== undefined)
      return this.scaffold(root, {
        profile: args.profile,
        name: args.name,
        dryRun: args.dryRun,
      });
    if (found === undefined) {
      const defaults = this.config.defaults();
      await mkdir(join(root, ProjectConfig.dir), { recursive: true });
      await writeFile(
        join(root, ProjectConfig.file),
        `${JSON.stringify(defaults, null, 2)}\n`,
      );
    }
    return this.sync(root);
  }

  /** Каркас (без перезаписи), затем sync; dry-run — только план */
  private async scaffold(
    root: string,
    options: InitOptions,
  ): Promise<CliResult> {
    let lines: string[];
    try {
      lines = await new ProjectInit(this.pkg).run(root, options);
    } catch (error) {
      return this.failure(error);
    }
    if (options.dryRun) return { ok: true, messages: lines };
    const synced = await this.sync(root);
    return {
      ok: synced.ok,
      messages: [...lines, ...synced.messages, ProjectInit.next],
    };
  }

  /** Ошибка ввода или коллизия (`GenError`) — не ok; прочее — дефект */
  private failure(error: unknown): CliResult {
    if (error instanceof GenError)
      return { ok: false, messages: [`Ошибка: ${error.message}`] };
    throw error;
  }

  async sync(root: string): Promise<CliResult> {
    const prepared = await this.prepare(root);
    if (typeof prepared === 'string')
      return { ok: false, messages: [prepared] };
    const { delivery, instructions } = prepared;
    const inspection = await delivery.inspect(root);
    await delivery.apply(root, inspection);
    if (instructions) {
      const text = await this.read(root, instructions);
      const next = this.block.apply(text);
      if (next !== text) await writeFile(join(root, instructions), next);
    }
    const messages = inspection.findings
      .filter((finding) => inspection.foreign.includes(finding.path))
      .map((finding) => `${finding.message}: ${finding.path}`);
    return { ok: messages.length === 0, messages };
  }

  async check(root: string): Promise<CliResult> {
    const prepared = await this.prepare(root);
    if (typeof prepared === 'string')
      return { ok: false, messages: [prepared] };
    const { delivery, instructions } = prepared;
    const messages = (await delivery.inspect(root)).findings.map(
      (finding) => `${finding.message}: ${finding.path}`,
    );
    if (
      instructions &&
      !this.block.isCurrent(await this.read(root, instructions))
    ) {
      messages.push(`нет вставки dmg-core или она устарела: ${instructions}`);
    }
    return { ok: messages.length === 0, messages };
  }

  /** Генератор; root — корень проекта, от него пути раскладки; нет конфига — по умолчанию */
  async gen(root: string, argv: readonly string[]): Promise<CliResult> {
    const loaded = await this.load(root);
    if (typeof loaded === 'string') return { ok: false, messages: [loaded] };
    const layout =
      loaded === undefined
        ? new GenLayout({ ...ProjectConfig.genDefaults }, root)
        : GenLayout.from(loaded.config, root);
    return this.generate(argv, layout);
  }

  private generate(argv: readonly string[], layout: GenLayout): CliResult {
    const messages: string[] = [];
    try {
      const code = runGen(
        argv,
        layout,
        (line) => messages.push(line),
        this.pkg.moduleDependencies(),
      );
      return { ok: code === 0, messages };
    } catch (error) {
      // Дефект поставки — сообщение без стека (main: stderr, код 1).
      if (!(error instanceof PackageDefectError)) throw error;
      return {
        ok: false,
        messages: [
          `Ошибка поставки dmg-core (переустанови пакет): ${error.message}`,
        ],
      };
    }
  }

  /** Настройки проекта → доставка; строка — сообщение об ошибке конфига */
  private async prepare(root: string): Promise<Prepared | string> {
    const loaded = await this.load(root);
    if (loaded === undefined) {
      return `нет ${ProjectConfig.file} — запусти dmg-core init`;
    }
    if (typeof loaded === 'string') return loaded;
    const { settings } = loaded;
    return {
      delivery: new Delivery(this.pkg, settings),
      instructions: settings.instructions ?? undefined,
    };
  }

  /** Конфиг и настройки доставки по нему; undefined — файла нет, строка — ошибка конфига */
  private async load(root: string): Promise<Loaded | string | undefined> {
    const config = await this.project(root);
    if (config === undefined || typeof config === 'string') return config;
    try {
      return { config, settings: this.config.parse(config) };
    } catch (error) {
      return this.configError(error);
    }
  }

  /** Конфиг проекта; undefined — файла нет, строка — ошибка конфига */
  private async project(
    root: string,
  ): Promise<ProjectConfig | string | undefined> {
    try {
      return await ProjectConfig.read(root);
    } catch (error) {
      return this.configError(error);
    }
  }

  /** `ProjectConfigError` — сообщение пользователю; прочее — дефект */
  private configError(error: unknown): string {
    if (error instanceof ProjectConfigError) return error.message;
    throw error;
  }

  private read(root: string, path: string): Promise<string> {
    return readFile(join(root, path), 'utf8').catch(() => '');
  }
}
