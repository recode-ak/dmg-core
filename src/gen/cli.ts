/** Разбор аргументов `dmg-core gen <kind> <m>[.<agg>] <name> [опции]`. */
import { GenError } from './gen-error';
import { GenFlags } from './gen-flags';
import type { GenLayout } from './layout';

export { GenError };

/**
 * Дефект поставки пакета dmg-core (нет версии зависимости в его
 * package.json): не ошибка ввода, но CLI сообщает о нём без стека.
 */
export class PackageDefectError extends Error {
  override name = 'PackageDefectError';
}

export type GenKind =
  | 'module'
  | 'aggregate'
  | 'uc'
  | 'er'
  | 'job'
  | 'dcs'
  | 'dqs';

export interface GenArgs {
  kind: GenKind;
  module: string;
  aggregate?: string;
  name?: string;
  write: boolean;
  /** Режим перевода legacy-модуля: существующие точки входа не перезаписываются. */
  adopt: boolean;
  /** Раскладка проекта (`.dmg/config.json`, `gen`) */
  layout: GenLayout;
  /**
   * Диапазоны внешних зависимостей пакета модуля (`gen.package`): имя →
   * версия; нужны `dmg-core` и `valibot` (JSON-репозитории `gen aggregate`)
   */
  dependencies?: Readonly<Record<string, string>>;
}

/** Что ожидает вид: цель (`m` или `m.agg`) и нужно ли имя. */
const SHAPE: Record<
  GenKind,
  { target: 'module' | 'aggregate'; name: boolean }
> = {
  module: { target: 'module', name: false },
  aggregate: { target: 'aggregate', name: false },
  uc: { target: 'aggregate', name: true },
  er: { target: 'aggregate', name: true },
  job: { target: 'aggregate', name: true },
  dcs: { target: 'module', name: true },
  dqs: { target: 'module', name: true },
};

/** Свои виды `dmg-core gen` — владелец `dmg-core`; каталог видов — `GenKinds` */
export const OWN_KINDS = Object.keys(SHAPE) as readonly GenKind[];

/** Подсказка своих видов; с видами поставщиков её дополняет `GenKinds` */
export const USAGE =
  'Использование: dmg-core gen <вид> <модуль>[.<агрегат>] [<имя>] [--write] ' +
  '[--dry-run] [--adopt]\n' +
  `Виды: ${OWN_KINDS.join(', ')}`;

export function parseArgs(argv: readonly string[], layout: GenLayout): GenArgs {
  const { positional, write, adopt } = GenFlags.parse(argv, USAGE);
  const [kind, target, name, ...rest] = positional;
  if (kind === undefined) throw new GenError(USAGE);
  if (!(kind in SHAPE)) {
    throw new GenError(`Неизвестный вид «${kind}»\n${USAGE}`);
  }
  const shape = SHAPE[kind as GenKind];
  if (target === undefined) {
    throw new GenError(
      `Не указан ${shape.target === 'module' ? 'модуль' : 'модуль.агрегат'}\n${USAGE}`,
    );
  }

  const [module = '', aggregate, ...tail] = target.split('.');
  if (shape.target === 'aggregate') {
    if (aggregate === undefined || tail.length > 0) {
      throw new GenError(
        `Для «${kind}» цель задаётся как <модуль>.<агрегат>, получено «${target}»`,
      );
    }
  } else if (aggregate !== undefined) {
    throw new GenError(
      `Для «${kind}» указывается только имя модуля, получено «${target}»`,
    );
  }

  if (shape.name && name === undefined) {
    throw new GenError(`Для «${kind}» нужно имя (kebab-case)\n${USAGE}`);
  }
  const extra = shape.name ? rest : [name, ...rest].filter((x) => x);
  if (extra.length > 0) {
    throw new GenError(`Указан лишний аргумент «${extra[0]}»\n${USAGE}`);
  }

  return {
    kind: kind as GenKind,
    module,
    ...(aggregate !== undefined && { aggregate }),
    ...(shape.name && name !== undefined && { name }),
    write,
    adopt,
    layout,
  };
}
