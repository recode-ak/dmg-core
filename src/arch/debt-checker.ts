import { join } from 'node:path';
import type {
  DebtCheckerOptions,
  DebtEntry,
  DebtInput,
  DebtLayout,
  DebtRegistryPaths,
  SourceFile,
} from './debt-checker.types';
import { DebtRegistry } from './debt-registry';
import { SourceWalk } from './source-walk';
import { Violation } from './violation';

/** ID любого реестра; префикс `X-` отличает чужой реестр от долга кода. */
const DEBT_ID = /(?<![A-Za-z])(?:([A-Z])-)?DEBT-\d+\b/g;
// Фразы, а не слово «временный»; `\b` для кириллицы не работает, «ВРЕМЕННЫЙ» — только заглавными.
const TEMP_MARKERS = [/временное решение|уходит с миграцией/gi, /ВРЕМЕННЫЙ/g];

const DEFAULT_PATHS: DebtRegistryPaths = {
  code: 'code',
  tests: 'tests',
  product: 'product',
};

/**
 * Учёт долга (ARC-12): реестры сверены с кодом. Долг кода — allowlist
 * (Место, Признак, Корень; ID в коде — только в `biome-ignore`; маркеры
 * временности — только в Месте), долг тестов — Файлы находят пути репо,
 * пробелы продукта — обязательные поля. Чистая проверка над памятью;
 * чтение диска — `read`. Решение и форматы реестров — D-84.
 * @see docs/reference/rules.md
 * @see docs/decisions.md
 */
export class DebtChecker {
  private readonly paths: DebtRegistryPaths;
  private readonly skip: readonly Bun.Glob[];

  constructor(private readonly options: DebtCheckerOptions) {
    this.paths = { ...DEFAULT_PATHS, ...options.registryPaths };
    this.skip = (options.tempMarkers?.skip ?? []).map((g) => new Bun.Glob(g));
  }

  /**
   * Исходники по glob'ам раскладки без `exclude`, все пути репо и реестры.
   * Какие каталоги не обходятся — `SourceWalk`. Реестр раскладки, которого
   * нет на диске, — в `missing`.
   */
  static async read(root: string, layout: DebtLayout): Promise<DebtInput> {
    const files = new SourceWalk(root).paths().sort();
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
    const missing: string[] = [];
    const text = async (path: string | undefined) => {
      if (path === undefined) return undefined;
      const f = Bun.file(join(root, path));
      if (await f.exists()) return f.text();
      missing.push(path);
      return undefined;
    };
    const { registries: r } = layout;
    const codeMd = await text(r.code);
    const tests = await text(r.tests);
    const product = await text(r.product);
    return {
      code,
      files,
      registries: {
        ...(codeMd === undefined ? {} : { code: codeMd }),
        ...(tests === undefined ? {} : { tests }),
        ...(product === undefined ? {} : { product }),
      },
      ...(missing.length ? { missing } : {}),
    };
  }

  check(input: DebtInput): Violation[] {
    const { registries } = input;
    const code = DebtRegistry.parse(
      registries.code ?? '',
      this.options.idPrefix,
    );
    const lines = [
      ...(input.missing ?? []).map((path) => `${path}: реестр не найден`),
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
