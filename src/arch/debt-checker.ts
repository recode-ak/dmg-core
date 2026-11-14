import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  DebtCheckerOptions,
  DebtEntry,
  DebtInput,
  DebtLayout,
  DebtRegistryPaths,
  SourceFile,
} from './debt-checker.types';
import { Violation } from './violation';

const HEADING = /^#{1,3}\s/;
const ID_HEADING = /^###\s+((?:[A-Z]-)?DEBT-\d+)\b/;
const FIELD = /^- \*\*([^*]+):\*\*(.*)$/;
const SUB_ITEM = /^ {2}- (.*)$/;
const FENCE = /^\s*```/;
const TICK = /^`([^`]+)`\s*,?\s*/;
/** ID любого реестра; префикс `X-` отличает чужой реестр от долга кода. */
const DEBT_ID = /(?<![A-Za-z])(?:([A-Z])-)?DEBT-\d+\b/g;
// Фразы, а не слово «временный»; `\b` для кириллицы не работает, «ВРЕМЕННЫЙ» — только заглавными.
const TEMP_MARKERS = [/временное решение|уходит с миграцией/gi, /ВРЕМЕННЫЙ/g];
/** Каталоги вне `files`: `node_modules` и `.git` на любой глубине, `data` — в корне. */
const SKIP_DIRS = new Set(['node_modules', '.git']);
const ROOT_SKIP_DIRS = new Set(['data']);

const DEFAULT_PATHS: DebtRegistryPaths = {
  code: 'code',
  tests: 'tests',
  product: 'product',
};

/**
 * Реестр долга одного вида: записи `### <prefix>-<n>` до следующего
 * заголовка (блоки ``` пропускаются), дубли, заголовки чужого префикса и
 * строка «Последний выданный ID». Поле — токены в бэктиках подряд в начале
 * строки поля и пунктов первого уровня под ним до пустой строки.
 */
class DebtRegistry {
  private constructor(
    private readonly prefix: string,
    private readonly md: string,
    readonly entries: ReadonlyMap<string, DebtEntry>,
    private readonly duplicates: readonly string[],
    private readonly foreign: readonly string[],
  ) {}

  static parse(md: string, prefix: string): DebtRegistry {
    const entries = new Map<string, DebtEntry>();
    const duplicates: string[] = [];
    const foreign: string[] = [];
    let entry: DebtEntry | undefined;
    let field: string[] | undefined;
    let fenced = false;
    for (const line of md.split('\n')) {
      if (FENCE.test(line)) {
        fenced = !fenced;
        continue;
      }
      if (fenced) continue;
      if (!line.trim()) {
        field = undefined;
        continue;
      }
      if (HEADING.test(line)) {
        field = undefined;
        entry = undefined;
        const id = ID_HEADING.exec(line)?.[1];
        if (id === undefined) continue;
        if (!id.startsWith(`${prefix}-`)) {
          foreign.push(id);
        } else if (entries.has(id)) {
          duplicates.push(id);
        } else {
          entry = { id, fields: new Map() };
          entries.set(id, entry);
        }
        continue;
      }
      if (!entry) continue;
      const f = FIELD.exec(line);
      if (f) {
        field = DebtRegistry.leadingTicks(f[2] ?? '');
        entry.fields.set(f[1] ?? '', field);
        continue;
      }
      const item = SUB_ITEM.exec(line);
      if (item && field)
        field.push(...DebtRegistry.leadingTicks(item[1] ?? ''));
    }
    return new DebtRegistry(prefix, md, entries, duplicates, foreign);
  }

  /** Токены в бэктиках подряд в начале текста (через запятую). */
  private static leadingTicks(text: string): string[] {
    const out: string[] = [];
    let rest = text.trimStart();
    for (let m = TICK.exec(rest); m; m = TICK.exec(rest)) {
      out.push(m[1] ?? '');
      rest = rest.slice(m[0].length);
    }
    return out;
  }

  /** Шапка и заголовки: чужой префикс, «Последний выданный ID», дубли. */
  checkHeadings(path: string): string[] {
    const out = this.foreign.map(
      (id) =>
        `${path}: заголовок ${id} — неверный префикс, нужен ${this.prefix}-<n>`,
    );
    const last = new RegExp(
      `Последний выданный ID:?\\**:?\\s*\`?${this.prefix}-(\\d+)`,
    ).exec(this.md);
    if (!last) out.push(`${path}: нет строки «Последний выданный ID»`);
    else {
      const max = Math.max(
        0,
        ...[...this.entries.keys()].map((id) => this.numberOf(id)),
      );
      const issued = Number(last[1]);
      if (issued < max)
        out.push(
          `${path}: «Последний выданный ID» ${this.prefix}-${issued} меньше максимального ${this.prefix}-${max}`,
        );
    }
    out.push(...this.duplicates.map((id) => `${id}: дубль записи`));
    return out;
  }

  private numberOf(id: string): number {
    return Number(id.slice(this.prefix.length + 1));
  }

  /** Обязательные поля записи и ровно одно из Погашает / Триггер. */
  static checkFields(e: DebtEntry, required: readonly string[]): string[] {
    const out = required
      .filter((name) => !e.fields.has(name))
      .map((name) => `${e.id}: нет поля ${name}`);
    const owner = e.fields.has('Погашает');
    const trigger = e.fields.has('Триггер');
    if (owner && trigger)
      out.push(`${e.id}: оба поля Погашает и Триггер — нужно одно`);
    if (!owner && !trigger) out.push(`${e.id}: нет поля Погашает или Триггер`);
    return out;
  }
}

/**
 * Учёт долга (ARC-12): реестры сверены с кодом. Долг кода — allowlist
 * (Место, Признак, Корень; ID в коде — только в `biome-ignore`; маркеры
 * временности — только в Месте), долг тестов — Файлы находят пути репо,
 * пробелы продукта — обязательные поля. Чистая проверка над памятью;
 * чтение диска — `read`.
 * @see docs/reference/rules.md
 */
export class DebtChecker {
  private readonly paths: DebtRegistryPaths;
  private readonly skip: readonly Bun.Glob[];

  constructor(private readonly options: DebtCheckerOptions) {
    this.paths = { ...DEFAULT_PATHS, ...options.registryPaths };
    this.skip = (options.tempMarkers?.skip ?? []).map((g) => new Bun.Glob(g));
  }

  /** Исходники по glob'ам раскладки без `exclude`, все пути репо и реестры. */
  static async read(root: string, layout: DebtLayout): Promise<DebtInput> {
    const files = DebtChecker.walk(root, '').sort();
    const include = layout.code.map((g) => new Bun.Glob(g));
    const exclude = (layout.exclude ?? []).map((g) => new Bun.Glob(g));
    const paths = files.filter(
      (p) =>
        include.some((g) => g.match(p)) && !exclude.some((g) => g.match(p)),
    );
    const code: SourceFile[] = await Promise.all(
      paths.map(async (path) => ({
        path,
        text: await Bun.file(join(root, path)).text(),
      })),
    );
    const text = (path: string | undefined) =>
      path === undefined ? undefined : Bun.file(join(root, path)).text();
    const { registries: r } = layout;
    const [codeMd, tests, product] = await Promise.all([
      text(r.code),
      text(r.tests),
      text(r.product),
    ]);
    return {
      code,
      files,
      registries: {
        code: codeMd,
        ...(tests === undefined ? {} : { tests }),
        ...(product === undefined ? {} : { product }),
      },
    };
  }

  /** Пути файлов каталога от корня репо, без пропускаемых каталогов. */
  private static walk(root: string, dir: string): string[] {
    const out: string[] = [];
    for (const d of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = dir ? `${dir}/${d.name}` : d.name;
      if (d.isDirectory()) {
        if (SKIP_DIRS.has(d.name) || (!dir && ROOT_SKIP_DIRS.has(d.name)))
          continue;
        out.push(...DebtChecker.walk(root, path));
      } else if (d.isFile()) out.push(path);
    }
    return out;
  }

  check(input: DebtInput): Violation[] {
    const { registries } = input;
    const code = DebtRegistry.parse(
      registries.code ?? '',
      this.options.idPrefix,
    );
    const lines = [
      ...(registries.code === undefined
        ? []
        : code.checkHeadings(this.paths.code)),
      ...[...code.entries.values()].flatMap((e) =>
        this.checkCodeEntry(e, input.code),
      ),
      ...this.checkIds(code, input.code),
      ...this.checkTempMarkers(code, input.code),
      ...this.checkTests(registries.tests, input.files),
      ...this.checkProduct(registries.product),
    ];
    return lines.map((message) => new Violation('ARC-12', message));
  }

  /** Строки отчёта: `ARC-12: <сообщение>`. */
  report(input: DebtInput): string[] {
    return this.check(input).map((v) => v.format());
  }

  /** Место и Признак записи: устаревший glob, погашенный glob, долг вне Места. */
  private checkCodeEntry(e: DebtEntry, code: readonly SourceFile[]): string[] {
    const fields = DebtRegistry.checkFields(e, ['Место', 'Признак']);
    const places = e.fields.get('Место') ?? [];
    const signText = e.fields.get('Признак')?.[0];
    if (!places.length || signText === undefined) return fields;
    let sign: RegExp;
    try {
      sign = new RegExp(signText, 'm');
    } catch {
      return [
        ...fields,
        `${e.id}: Признак \`${signText}\` — неверная регулярка`,
      ];
    }

    const out = [...fields];
    const globs = places.map((p) => new Bun.Glob(p));
    places.forEach((place, i) => {
      const files = code.filter((f) => globs[i]?.match(f.path));
      if (!files.length)
        out.push(
          `${e.id}: Место \`${place}\` не находит файлов — устаревшее место`,
        );
      else if (!files.some((f) => sign.test(f.text)))
        out.push(
          `${e.id}: долг погашен (\`${place}\`) — сними glob или закрой запись`,
        );
    });

    const rootText = e.fields.get('Корень')?.[0];
    const root = rootText === undefined ? undefined : new Bun.Glob(rootText);
    if (root && !code.some((f) => root.match(f.path)))
      return [...out, `${e.id}: Корень \`${rootText}\` не находит файлов`];
    for (const f of code) {
      if (root && !root.match(f.path)) continue;
      if (globs.some((g) => g.match(f.path))) continue;
      const m = sign.exec(f.text);
      if (m) {
        const line = f.text.slice(0, m.index).split('\n').length;
        out.push(`${e.id}: долг без записи — ${f.path}:${line}`);
      }
    }
    return out;
  }

  /**
   * ID долга кода в коде: запись есть и ID — в строке `biome-ignore`. ID с
   * префиксом другого реестра пропускается; голый `DEBT-<n>` — свой.
   */
  private checkIds(
    registry: DebtRegistry,
    code: readonly SourceFile[],
  ): string[] {
    const own = this.options.idPrefix;
    const out: string[] = [];
    for (const f of code)
      f.text.split('\n').forEach((line, i) => {
        for (const m of line.matchAll(DEBT_ID)) {
          const id = m[0];
          if (m[1] !== undefined && !id.startsWith(`${own}-`)) continue;
          const at = `${f.path}:${i + 1}: ${id}`;
          if (!registry.entries.has(id))
            out.push(`${at} — нет записи в ${this.paths.code}`);
          else if (!line.includes('biome-ignore'))
            out.push(`${at} вне biome-ignore`);
        }
      });
    return out;
  }

  /** Маркер временности допустим только в файле из Места записи. */
  private checkTempMarkers(
    registry: DebtRegistry,
    code: readonly SourceFile[],
  ): string[] {
    const places = [...registry.entries.values()].flatMap((e) =>
      (e.fields.get('Место') ?? []).map((p) => new Bun.Glob(p)),
    );
    const out: string[] = [];
    for (const f of code) {
      if (this.skip.some((g) => g.match(f.path))) continue;
      if (places.some((g) => g.match(f.path))) continue;
      f.text.split('\n').forEach((line, i) => {
        for (const re of TEMP_MARKERS)
          for (const [phrase] of line.matchAll(re))
            out.push(
              `${f.path}:${i + 1}: маркер временности «${phrase}» вне Места открытой записи — заведи запись в ${this.paths.code} или убери комментарий`,
            );
      });
    }
    return out;
  }

  /** Долг тестов: каждый glob Файлы находит хотя бы один путь репо. */
  private checkTests(
    md: string | undefined,
    files: readonly string[],
  ): string[] {
    if (md === undefined) return [];
    const registry = DebtRegistry.parse(md, 'T-DEBT');
    const out = registry.checkHeadings(this.paths.tests ?? 'tests');
    for (const e of registry.entries.values()) {
      out.push(...DebtRegistry.checkFields(e, ['Файлы']));
      for (const pattern of e.fields.get('Файлы') ?? []) {
        const glob = new Bun.Glob(pattern);
        if (!files.some((p) => glob.match(p)))
          out.push(
            `${e.id}: Файлы \`${pattern}\` не находит файлов — случай почищен или файл переехал`,
          );
      }
    }
    return out;
  }

  /** Пробелы продукта: поля Суть, Причина, Критерий снятия. */
  private checkProduct(md: string | undefined): string[] {
    if (md === undefined) return [];
    const registry = DebtRegistry.parse(md, 'D-DEBT');
    const out = registry.checkHeadings(this.paths.product ?? 'product');
    for (const e of registry.entries.values())
      out.push(
        ...DebtRegistry.checkFields(e, ['Суть', 'Причина', 'Критерий снятия']),
      );
    return out;
  }
}
