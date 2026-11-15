import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { AppGraph } from '../graph/domain/app-graph';
import type { GraphApp } from '../graph/domain/graph-app.types';
import { GraphError } from '../graph/graph-error';
import type { CliResult } from './dmg-core-cli';

/** Разобранные аргументы `graph`. */
type GraphArgs = { readonly file: string; readonly out: string };

/** Ошибка ввода `graph`: сообщение — пользователю, код 2. */
class GraphArgsError extends Error {}

/** Отказ `graph` по состоянию проекта: сообщение — пользователю, код 1. */
class GraphInputError extends Error {}

/**
 * Команда `dmg-core graph <файл> [--out <путь>]` (D-96): документ графа
 * приложения формата 1 — в `graph.json` корня проекта или в `--out`. Файл —
 * `export default` вида `GraphApp`; версия приложения — из `package.json`
 * корня. Ошибка ввода — `usage: true` (код 2 и `USAGE` у вызывающего).
 * @see src/cli/main-graph.test.ts
 */
export class GraphCommand {
  constructor(private readonly root: string) {}

  async run(
    argv: readonly string[],
  ): Promise<CliResult & { readonly usage?: true }> {
    try {
      const args = this.parse(argv);
      const app = await this.load(args.file);
      const document = new AppGraph(app).document(await this.version());
      const out = resolve(this.root, args.out);
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, document.serialize());
      const { nodes, edges, externals } = document.toJSON();
      const counts = `узлов — ${nodes.length}, рёбер — ${edges.length}, внешних ссылок — ${externals.length}`;
      return { ok: true, messages: [`Записан: ${args.out} (${counts})`] };
    } catch (error) {
      if (error instanceof GraphArgsError) {
        return { ok: false, usage: true, messages: [error.message] };
      }
      if (error instanceof GraphInputError) {
        return { ok: false, messages: [error.message] };
      }
      if (error instanceof GraphError) {
        return { ok: false, messages: [`graph: ${error.message}`] };
      }
      throw error;
    }
  }

  private parse(argv: readonly string[]): GraphArgs {
    let file: string | undefined;
    let out = 'graph.json';
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i] ?? '';
      if (arg === '--out') {
        const value = argv[++i];
        if (value === undefined || value.startsWith('--')) {
          throw new GraphArgsError('graph: у флага --out нет значения');
        }
        out = value;
      } else if (arg.startsWith('--')) {
        throw new GraphArgsError(`graph: неизвестный флаг ${arg}`);
      } else if (file !== undefined) {
        throw new GraphArgsError(`graph: лишний аргумент ${arg}`);
      } else {
        file = arg;
      }
    }
    if (file === undefined) {
      throw new GraphArgsError('graph: не указан файл приложения');
    }
    return { file, out };
  }

  // Форма проверяется по признакам, а не `instanceof`: файл проекта и CLI
  // могут получить разные экземпляры пакета.
  private async load(file: string): Promise<GraphApp> {
    const path = resolve(this.root, file);
    if (!(await Bun.file(path).exists())) {
      throw new GraphInputError(`graph: нет файла ${file}`);
    }
    const entry: { default?: Partial<GraphApp> } = await import(path);
    const app = entry.default;
    const providers = app?.providers ?? [];
    if (app?.def?.dmg !== 'app' || !Array.isArray(providers)) {
      throw new GraphInputError(
        `graph: ${file} — нужен export default { def: AppDef, providers?: GraphProvider[] }`,
      );
    }
    return { def: app.def, providers };
  }

  /** Версия приложения — `version` из `package.json` проекта; не выдумывается. */
  private async version(): Promise<string> {
    const manifest = Bun.file(resolve(this.root, 'package.json'));
    const found: { version?: unknown } = (await manifest.exists())
      ? await manifest.json()
      : {};
    if (typeof found.version !== 'string' || found.version === '') {
      throw new GraphInputError('graph: в package.json проекта нет version');
    }
    return found.version;
  }
}
