import type { DocLine, DocLink, DocListItem } from './docs.types';

/** Front-matter в начале файла: `---`, строки, `---` (как `covers-check`) */
const FRONT_MATTER_RE = /^---\n[\s\S]*?\n---\n/;
/** Строка-граница блока кода ``` или ~~~ */
const FENCE_RE = /^\s*(?:```|~~~)/;
const HEADING_RE = /^#{1,6}\s+(.*?)\s*#*\s*$/;
/**
 * Вставка кода в бэктиках или ссылка `[текст](href)`; срабатывает то, что
 * левее. Вставка поглощает ссылку внутри себя, а код в тексте ссылки
 * (`` [`x.md`](./x.md) ``) — часть ссылки: пример в бэктиках — не навигация,
 * а код в тексте ссылки — самая частая форма ссылки на путь.
 */
const TOKEN_RE = /(`+)[^\n]*?\1|\[((?:`[^`\n]*`|[^\]`])*)\]\(([^)\s]+)\)/g;
/** Внешняя ссылка: со схемой (`https:`, `mailto:`) */
const EXTERNAL_RE = /^[a-z]+:/i;
/** Начало пункта списка: отступ, маркер `-`, `*`, `+` или `N.`, пробел */
const ITEM_RE = /^\s*(?:[-*+]|\d+\.)\s+/;
/** Строка шапки, объявляющая реестр (`docs-format.md` § 6) */
const REGISTRY_RE = /^\*\*(?:Серия|Архив):\*\*/;
/** Заголовок, которым кончается шапка документа: `##` или `###` */
const HEADER_END_RE = /^#{2,3}\s/;

/** Ссылка строки и её позиция в строке: нужна пунктам списка */
type PlacedLink = {
  readonly link: DocLink;
  readonly start: number;
  readonly end: number;
};

/**
 * Документ markdown в памяти: строки, ссылки, якоря, пункты списков вне кода.
 * Блоки кода и вставки в бэктиках — примеры, а не навигация: их ссылки и
 * заголовки не берутся (`docs-format.md` § 1).
 * @see src/cli/docs/markdown-doc.test.ts
 */
export class MarkdownDoc {
  private anchorSet?: ReadonlySet<string>;

  constructor(
    readonly path: string,
    readonly text: string,
  ) {}

  /** Строки тела без front-matter; последний перевод строки строку не добавляет */
  get lineCount(): number {
    const body = this.text.slice(this.frontMatter().length);
    if (body === '') return 0;
    return body.split('\n').length - (body.endsWith('\n') ? 1 : 0);
  }

  /**
   * Ссылки на файлы вне кода, в порядке текста; внешние (`схема:`) не берутся.
   * Ссылка разбирается в пределах строки: текст ссылки с переносом на другую
   * строку, `]` внутри текста и картинка внутри ссылки не берутся.
   */
  links(): DocLink[] {
    return this.textLines().flatMap(({ text, line }) =>
      this.placed(text, line)
        .map(({ link }) => link)
        .filter((link) => !EXTERNAL_RE.test(link.target)),
    );
  }

  /** Якоря заголовков вне кода по правилам GitHub; повтор — `-1`, `-2` */
  anchors(): ReadonlySet<string> {
    if (this.anchorSet) return this.anchorSet;
    const anchors = new Set<string>();
    const seen = new Map<string, number>();
    for (const { text } of this.textLines()) {
      const heading = HEADING_RE.exec(text);
      if (!heading) continue;
      const slug = (heading[1] ?? '')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\p{M} _-]/gu, '')
        .replace(/ /g, '-');
      const count = seen.get(slug) ?? 0;
      seen.set(slug, count + 1);
      anchors.add(count === 0 ? slug : `${slug}-${count}`);
    }
    this.anchorSet = anchors;
    return anchors;
  }

  /**
   * Якорь ведёт на заголовок. Пустой — не якорь, живой; %-кодировка
   * декодируется, не декодируется — берётся как есть.
   */
  hasAnchor(anchor: string): boolean {
    if (anchor === '') return true;
    let name = anchor;
    try {
      name = decodeURIComponent(anchor);
    } catch {
      // `#100%` — не %-кодировка: сверяется как написано
    }
    return this.anchors().has(name);
  }

  /** В шапке есть строка вне кода, начинающаяся с `**Серия:**` или `**Архив:**` */
  isRegistry(): boolean {
    return this.header().some(
      ({ text, code }) => !code && REGISTRY_RE.test(text),
    );
  }

  /**
   * Шапка: строки тела до первого заголовка `##` или `###` вне кода
   * (`docs-format.md` § 6); заголовка нет — всё тело.
   */
  header(): DocLine[] {
    const lines = this.lines();
    const end = lines.findIndex(
      ({ text, code }) => !code && HEADER_END_RE.test(text),
    );
    return end === -1 ? lines : lines.slice(0, end);
  }

  /**
   * Строки тела без front-matter с номерами строк файла; строки блока кода
   * вместе с его границами — с признаком `code`.
   */
  lines(): DocLine[] {
    const skip = this.frontMatter().split('\n').length - 1;
    const lines: DocLine[] = [];
    let fenced = false;
    this.text.split('\n').forEach((text, i) => {
      if (i < skip) return;
      const fence = FENCE_RE.test(text);
      if (fence) fenced = !fenced;
      lines.push({ text, line: i + 1, code: fence || fenced });
    });
    return lines;
  }

  /**
   * Пункты списка, начинающиеся ссылкой. Подпись — текст после разделителя
   * (`: ` в `.txt`, ` — ` в прочих); нет разделителя, пусто или подпись
   * начинается второй ссылкой — подписи нет.
   */
  listItems(): DocListItem[] {
    const separator = this.path.endsWith('.txt') ? ': ' : ' — ';
    const items: DocListItem[] = [];
    for (const { text, line } of this.textLines()) {
      const marker = ITEM_RE.exec(text)?.[0];
      if (marker === undefined) continue;
      const placed = this.placed(text, line);
      const [first, second] = placed;
      if (first?.start !== marker.length) continue;
      const links = placed.map(({ link }) => link);
      const after = first.end + separator.length;
      const tail = text.slice(after);
      const caption = tail.trim();
      const linked =
        second?.start === after + tail.length - tail.trimStart().length;
      const captioned =
        text.startsWith(separator, first.end) && caption !== '' && !linked;
      items.push(captioned ? { line, links, caption } : { line, links });
    }
    return items;
  }

  /** Front-matter с завершающим переводом строки; нет — пустая строка */
  private frontMatter(): string {
    return FRONT_MATTER_RE.exec(this.text)?.[0] ?? '';
  }

  /** Строки вне front-matter и блоков кода с номерами строк файла */
  private textLines(): DocLine[] {
    return this.lines().filter(({ code }) => !code);
  }

  /** Ссылки строки вне вставок кода (внешние — тоже) с позициями */
  private placed(text: string, line: number): PlacedLink[] {
    const found: PlacedLink[] = [];
    for (const match of text.matchAll(TOKEN_RE)) {
      const href = match[3];
      if (href === undefined) continue;
      const hash = href.indexOf('#');
      const link: DocLink =
        hash === -1
          ? { href, target: href, line }
          : {
              href,
              target: href.slice(0, hash),
              anchor: href.slice(hash + 1),
              line,
            };
      found.push({
        link,
        start: match.index,
        end: match.index + match[0].length,
      });
    }
    return found;
  }
}
