/**
 * Метка копии, доставленной `dmg-core sync`: по ней CLI узнаёт свои файлы,
 * пакет-владельца и его версию (`<пакет>@<версия>`). Ставится после
 * frontmatter (или в начало файла без него).
 */
export class Marker {
  private static readonly pattern =
    /<!-- (\S+)@([^@\s]+): сгенерировано `dmg-core sync` — не править -->\n\n/;
  private static readonly frontmatter = /^---\n[\s\S]*?\n---\n\n?/;

  readonly comment: string;

  constructor(
    readonly version: string,
    readonly name = 'dmg-core',
  ) {
    this.comment = `<!-- ${name}@${version}: сгенерировано \`dmg-core sync\` — не править -->`;
  }

  /** Метка любого пакета в тексте; undefined — файл не сгенерирован */
  static of(text: string): Marker | undefined {
    const match = Marker.pattern.exec(text);
    if (!match) return undefined;
    const [, name = '', version = ''] = match;
    return new Marker(version, name);
  }

  /** Версия пакета из метки; undefined — файл не сгенерирован */
  static versionOf(text: string): string | undefined {
    return Marker.of(text)?.version;
  }

  /** Текст без метки (любого пакета) — исходник, из которого сделана копия */
  static strip(text: string): string {
    return text.replace(Marker.pattern, '');
  }

  /** Текст с этой меткой */
  mark(text: string): string {
    const head = Marker.frontmatter.exec(text)?.[0] ?? '';
    return `${head}${this.comment}\n\n${text.slice(head.length)}`;
  }
}
