import type { DocsLimits } from '../../gen/project-config.types';
import type { MarkdownDoc } from './markdown-doc';

/** Вид документа в дереве: от него зависят бюджет и подпись (`docs-format.md` § 1) */
export type DocKind = 'generated' | 'entry' | 'registry' | 'index' | 'leaf';

/** Ссылка `[текст](href)` вне кода: цель без якоря, якорь, номер строки файла (с 1) */
export type DocLink = {
  readonly href: string;
  readonly target: string;
  readonly anchor?: string;
  readonly line: number;
};

/** Пункт списка, начинающийся ссылкой; `caption` — подпись после разделителя, нет — undefined */
export type DocListItem = {
  readonly line: number;
  readonly links: readonly DocLink[];
  readonly caption?: string;
};

/** Умолчания секции `docs`: вход и бюджеты */
export type DocsDefaults = {
  readonly entries: readonly string[];
  readonly limits: DocsLimits;
};

/** Результат обхода дерева: документы обхода, прочитанное ради якорей, существование целей */
export type DocsTreeRead = {
  /** Документы обхода, в порядке обхода в ширину от входов */
  readonly docs: readonly MarkdownDoc[];
  /** `.md` вне обхода (`node_modules`, генерируемое), читаются только ради якорей; ключ — путь от корня */
  readonly targets: ReadonlyMap<string, MarkdownDoc>;
  /** Существует ли путь от корня: цель ссылки или путь `exempt`; с `/` на конце — только каталог */
  readonly exists: (path: string) => boolean;
  /** Входы, которых нет на диске */
  readonly missingEntries: readonly string[];
};
