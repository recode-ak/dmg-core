import { ProjectConfig, ProjectConfigError } from '../gen/project-config';
import { DocIds } from './docs/doc-ids';
import type { DocRegistries } from './docs/doc-registries';
import { DocSources } from './docs/doc-sources';
import type { DocResolution, DocsTreeRead } from './docs/docs.types';
import { DocsChecker } from './docs/docs-checker';
import { DocsLibrary } from './docs/docs-library';
import { DocsSettings } from './docs/docs-settings';
import { DocsTree } from './docs/docs-tree';
import { IdGrammar } from './docs/id-grammar';
import type { DocsResult } from './docs-command.types';
import { ProviderError } from './provider-package';

/** Ошибка ввода `docs`: сообщение — пользователю, код 2. */
class DocsArgsError extends Error {}

/** Причина, по которой `show` не выдаёт запись, — по итогу разрешения ID */
const REASONS: Readonly<
  Record<Exclude<DocResolution['status'], 'record'>, string>
> = {
  missing: 'нет записи в реестре серии',
  closed:
    'закрыта: номер не больше «Последнего выданного ID», запись удалена из реестра',
  archive: 'в архиве серии: запись у проекта-источника',
  undeclared: 'серия не объявлена ни в одном реестре',
};

/** Дерево проекта и источники реестров: проект, ядро, поставщики */
type Loaded = {
  readonly settings: DocsSettings;
  readonly tree: DocsTreeRead;
  readonly registries: DocRegistries;
};

/**
 * Команда `dmg-core docs`: `--check` — проверка дерева документации проекта
 * от входов `docs.entries` с реестрами и ID (`docs-format.md` § 12); `show`
 * — записи реестров по ID из проекта, ядра и поставщиков (§ 6). Корень —
 * каталог запуска, `coreRoot` — корень пакета самого CLI; нет конфига —
 * вход `llms.txt`. Нарушения и ненайденные ID — `ok: false`; ошибка ввода —
 * `usage: true`; отказ конфига или поставщика — сообщение без стека.
 * @see src/cli/docs-command.test.ts
 * @see src/cli/main-docs.test.ts
 */
export class DocsCommand {
  constructor(
    private readonly root: string,
    private readonly coreRoot: string,
  ) {}

  async run(argv: readonly string[]): Promise<DocsResult> {
    try {
      return argv[0] === 'show'
        ? await this.show(argv.slice(1))
        : await this.check(argv);
    } catch (error) {
      if (error instanceof DocsArgsError) {
        return { ok: false, usage: true, messages: [error.message] };
      }
      if (
        error instanceof ProjectConfigError ||
        error instanceof ProviderError
      ) {
        return { ok: false, messages: [error.message] };
      }
      throw error;
    }
  }

  private async check(argv: readonly string[]): Promise<DocsResult> {
    this.parseCheck(argv);
    const { settings, tree, registries } = await this.load();
    const sources = await new DocSources(this.root, settings).read();
    const violations = new DocsChecker(settings).check(tree, [
      registries,
      new DocIds(registries, tree.docs, sources),
    ]);
    if (violations.length === 0) {
      return {
        ok: true,
        messages: [
          `docs --check: нарушений нет (документов — ${tree.docs.length})`,
        ],
      };
    }
    return {
      ok: false,
      messages: [
        ...violations.map((violation) => violation.format()),
        `docs --check: нарушений — ${violations.length}`,
      ],
    };
  }

  /**
   * Записи по ID в порядке аргументов: строка источника `<ID> — <источник>,
   * <путь>:<строка>` и текст записи, записи — через пустую строку; с
   * `--titles` — по строке на запись. Ненайденные — причиной в `messages`.
   */
  private async show(argv: readonly string[]): Promise<DocsResult> {
    const { ids, titles } = this.parseShow(argv);
    const { registries } = await this.load();
    const blocks: string[] = [];
    const missing: string[] = [];
    for (const id of ids) {
      const found = registries.find(id);
      const parsed = IdGrammar.parse(id);
      if (found.length === 0 && parsed) {
        const { status } = registries.resolve(parsed.prefix, parsed.number);
        if (status !== 'record') missing.push(`${id}: ${REASONS[status]}`);
      }
      for (const { source, record } of found) {
        const head = `${record.id} — ${source.name}, ${registries.pathOf(source, record.path)}:${record.line}`;
        blocks.push(
          titles ? `${head} — ${record.title}` : `${head}\n${record.text}`,
        );
      }
    }
    const out = titles
      ? blocks
      : blocks.flatMap((block, i) => (i === 0 ? [block] : ['', block]));
    return { ok: missing.length === 0, messages: missing, out };
  }

  /** Конфиг, дерево проекта и реестры всех источников */
  private async load(): Promise<Loaded> {
    const config = await ProjectConfig.read(this.root);
    const settings = DocsSettings.of(config?.docs);
    const tree = await new DocsTree(this.root, settings).read();
    const registries = await DocsLibrary.load({
      root: this.root,
      coreRoot: this.coreRoot,
      providers: config?.providers ?? [],
      project: tree.docs,
    });
    return { settings, tree, registries };
  }

  /** Ровно один аргумент — `--check` */
  private parseCheck(argv: readonly string[]): void {
    for (const arg of argv) {
      if (arg === '--check') continue;
      throw new DocsArgsError(
        arg.startsWith('-')
          ? `docs: неизвестный флаг ${arg}`
          : `docs: лишний аргумент ${arg}`,
      );
    }
    if (argv.length !== 1) {
      throw new DocsArgsError(
        argv.length === 0 ? 'docs: нужен флаг --check' : 'docs: повтор --check',
      );
    }
  }

  /** ID и флаг `--titles` в любом месте; хотя бы один ID */
  private parseShow(argv: readonly string[]): {
    readonly ids: readonly string[];
    readonly titles: boolean;
  } {
    const ids: string[] = [];
    let titles = false;
    for (const arg of argv) {
      if (arg === '--titles') {
        titles = true;
      } else if (arg.startsWith('-')) {
        throw new DocsArgsError(`docs show: неизвестный флаг ${arg}`);
      } else if (!IdGrammar.isId(arg)) {
        throw new DocsArgsError(
          `docs show: «${arg}» — не ID (нужен вид P-N, например D-114)`,
        );
      } else {
        ids.push(arg);
      }
    }
    if (ids.length === 0) {
      throw new DocsArgsError('docs show: нужен хотя бы один ID');
    }
    return { ids, titles };
  }
}
