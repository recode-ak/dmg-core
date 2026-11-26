import type { DocsLimits } from '../../gen/project-config.types';
import type { DocRegistry } from './doc-registry';
import type { DocReport } from './doc-report';
import type { MarkdownDoc } from './markdown-doc';

/** Вид документа в дереве: от него зависят бюджет и подпись (`docs-format.md` § 1) */
export type DocKind = 'generated' | 'entry' | 'registry' | 'index' | 'leaf';

/** Строка тела документа: текст, номер строки файла (с 1), в блоке кода ли (границы блока — тоже) */
export type DocLine = {
  readonly text: string;
  readonly line: number;
  readonly code: boolean;
};

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

/** Часть общего отчёта `docs --check`: добавляет свои нарушения в отчёт */
export type DocReportPart = {
  report(into: DocReport): void;
};

/** Упоминание ID в тексте: написание, префикс серии, номер числом, позиция в тексте */
export type IdMention = {
  readonly id: string;
  readonly prefix: string;
  readonly number: number;
  readonly index: number;
};

/** Запись реестра: заголовок `###` или строка таблицы `ID` */
export type DocRecord = {
  /** Написание ID в записи (`D-01`) */
  readonly id: string;
  readonly prefix: string;
  readonly number: number;
  /** Заголовок: суть после ID у `heading`, сама строка у `row` */
  readonly title: string;
  /** Текст при выдаче: заголовок и тело без хвостовых `---` и пустых строк; шапка, разделитель и строка таблицы */
  readonly text: string;
  readonly path: string;
  /** Номер строки файла (с 1): заголовок или строка таблицы */
  readonly line: number;
  readonly form: 'heading' | 'row';
};

/** Архив реестра: диапазон владельца серии или серия у держателя чужих записей */
export type DocArchive =
  | {
      readonly kind: 'range';
      readonly prefix: string;
      readonly from: number;
      readonly to: number;
    }
  | { readonly kind: 'series'; readonly prefix: string };

/** Откуда реестр: проект, ядро или поставщик; `root` — каталог источника */
export type DocSource = {
  readonly name: string;
  readonly root: string;
  readonly project: boolean;
};

/** Реестры одного источника */
export type DocSourceRegistries = {
  readonly source: DocSource;
  readonly registries: readonly DocRegistry[];
};

/** Запись с источником */
export type DocFound = {
  readonly source: DocSource;
  readonly record: DocRecord;
};

/** Итог разрешения ID: запись, закрыта, архив, нет записи, серия не объявлена */
export type DocResolution =
  | { readonly status: 'record'; readonly found: readonly DocFound[] }
  | {
      readonly status: 'closed' | 'archive' | 'missing' | 'undeclared';
    };

/** Откуда брать реестры: корень проекта и ядра, поставщики из конфига, документы проекта */
export type DocsLibraryInput = {
  readonly root: string;
  readonly coreRoot: string;
  readonly providers: readonly string[];
  readonly project: readonly MarkdownDoc[];
};
