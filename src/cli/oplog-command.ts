import { OperationLogFeed } from '../app/oplog/operation-log-feed';
import {
  type OperationLogFilter,
  OperationLogFilterError,
  OperationLogReader,
} from '../app/oplog/operation-log-reader';
import type { OperationRecord } from '../app/oplog/operation-record';
import type { CliResult } from './dmg-core-cli';

/** Разобранные аргументы `oplog`. */
type OplogArgs = {
  readonly dir: string;
  readonly filter: OperationLogFilter;
  readonly json: boolean;
};

/** Флаги со значением; разбор значения — `OplogCommand.withValue`. */
const VALUED: ReadonlySet<string> = new Set([
  '--request',
  '--aggregate',
  '--subject',
  '--module',
  '--op',
  '--since',
  '--until',
]);

/** Ошибка ввода `oplog`: сообщение — пользователю, код 2. */
class OplogArgsError extends Error {}

/**
 * Команда `dmg-core oplog <dir> [фильтры] [--json]` (D-86): лента или JSONL
 * записей лога операций. Пакет проекта не нужен — читается только каталог.
 * Ошибка ввода — `usage: true` (код 2 и `USAGE` у вызывающего).
 * @see src/cli/main-oplog.test.ts
 */
export class OplogCommand {
  async run(
    argv: readonly string[],
  ): Promise<CliResult & { readonly usage?: true }> {
    let args: OplogArgs;
    let records: OperationRecord[];
    try {
      args = this.parse(argv);
      records = await new OperationLogReader(args.dir).read(args.filter);
    } catch (error) {
      if (
        error instanceof OplogArgsError ||
        error instanceof OperationLogFilterError
      ) {
        return { ok: false, usage: true, messages: [error.message] };
      }
      throw error;
    }
    const messages = args.json
      ? records.map((r) => JSON.stringify(r))
      : new OperationLogFeed().lines(records, {
          aggregate: args.filter.aggregate,
        });
    return { ok: true, messages };
  }

  private parse(argv: readonly string[]): OplogArgs {
    const [dir, ...rest] = argv;
    if (dir === undefined || dir.startsWith('--')) {
      throw new OplogArgsError('oplog: не указан каталог лога');
    }
    let filter: OperationLogFilter = {};
    let json = false;
    for (let i = 0; i < rest.length; i++) {
      const flag = rest[i] ?? '';
      if (flag === '--json') json = true;
      else if (flag === '--failed') filter = { ...filter, failed: true };
      else {
        if (!VALUED.has(flag)) {
          throw new OplogArgsError(`oplog: неизвестный флаг ${flag}`);
        }
        const value = rest[i + 1];
        if (value === undefined || value.startsWith('--')) {
          throw new OplogArgsError(`oplog: у флага ${flag} нет значения`);
        }
        filter = this.withValue(filter, flag, value);
        i++;
      }
    }
    return { dir, filter, json };
  }

  private withValue(
    filter: OperationLogFilter,
    flag: string,
    value: string,
  ): OperationLogFilter {
    switch (flag) {
      case '--request':
        return { ...filter, request: value };
      case '--aggregate':
        return { ...filter, aggregate: value };
      case '--subject':
        return { ...filter, subject: value };
      case '--module':
        return { ...filter, module: value };
      case '--op':
        return { ...filter, op: value };
      case '--since':
        return { ...filter, since: value };
      case '--until':
        return { ...filter, until: value };
      default:
        throw new OplogArgsError(`oplog: неизвестный флаг ${flag}`);
    }
  }
}
