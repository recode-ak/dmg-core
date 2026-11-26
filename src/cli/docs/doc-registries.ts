import { isAbsolute, join, relative } from 'node:path';
import type { DocRegistry } from './doc-registry';
import type { DocReport } from './doc-report';
import type {
  DocFound,
  DocRecord,
  DocResolution,
  DocSource,
  DocSourceRegistries,
} from './docs.types';
import { IdGrammar } from './id-grammar';

/** Ссылка на правило в сообщениях */
const RULE = 'docs-format.md § 6';

/** Реестр вместе с источником */
type Placed = { readonly source: DocSource; readonly registry: DocRegistry };

/**
 * Реестры всех источников: проект, ядро, поставщики — в порядке на входе.
 * Находит записи по ID, разрешает ID и проверяет согласованность реестров
 * (DOC-06 между реестрами и внутри реестров проекта). Нарушение между
 * реестрами — у реестра проекта, без проекта — у реестра, объявившего позже:
 * конфликт видит только проект, иначе молча берётся первый.
 * @see src/cli/docs/doc-registries.test.ts
 */
export class DocRegistries {
  private readonly placed: readonly Placed[];

  constructor(private readonly sources: readonly DocSourceRegistries[]) {
    this.placed = sources.flatMap(({ source, registries }) =>
      registries.map((registry) => ({ source, registry })),
    );
  }

  /** Грамматика по префиксам всех объявленных серий */
  grammar(): IdGrammar {
    return new IdGrammar(
      this.placed.flatMap(({ registry }) => registry.series),
    );
  }

  /** Все записи с этим ID (номер числом: `D-1` находит `D-01`), в порядке источников */
  find(id: string): DocFound[] {
    const parsed = IdGrammar.parse(id);
    return parsed ? this.records(parsed.prefix, parsed.number) : [];
  }

  /** Запись, закрыта (номер не больше «Последнего выданного»), архив, нет записи, серия не объявлена */
  resolve(prefix: string, number: number): DocResolution {
    const found = this.records(prefix, number);
    if (found.length > 0) return { status: 'record', found };
    const owners = this.owners(prefix).map(({ registry }) => registry);
    if (owners.length === 0) return { status: 'undeclared' };
    if (owners.some((owner) => number <= (owner.lastIssued.get(prefix) ?? 0))) {
      return { status: 'closed' };
    }
    const archived = owners.some((owner) =>
      owner.archive.some(
        (item) =>
          item.kind === 'range' &&
          item.prefix === prefix &&
          item.from <= number &&
          number <= item.to,
      ),
    );
    return { status: archived ? 'archive' : 'missing' };
  }

  /**
   * Путь файла источника для сообщений и выдачи: у проекта и внутри его
   * корня — от корня проекта, иначе абсолютный.
   */
  pathOf(source: DocSource, path: string): string {
    if (source.project) return path;
    const full = join(source.root, path);
    const root = this.sources.find((item) => item.source.project)?.source.root;
    if (root === undefined) return full;
    const inside = relative(root, full);
    return inside.startsWith('..') || isAbsolute(inside) ? full : inside;
  }

  /** DOC-06 между реестрами и внутри реестров проекта; нарушения реестров поставщика не выводятся */
  report(into: DocReport): void {
    for (const { source, registry } of this.placed) {
      if (source.project) registry.report(into);
    }
    this.reportSeries(into);
    this.reportRecords(into);
  }

  private records(prefix: string, number: number): DocFound[] {
    return this.placed.flatMap(({ source, registry }) =>
      registry.records
        .filter(
          (record) => record.prefix === prefix && record.number === number,
        )
        .map((record) => ({ source, record })),
    );
  }

  /** Реестры, объявившие префикс «Серией», в порядке источников */
  private owners(prefix: string): Placed[] {
    return this.placed.filter(({ registry }) =>
      registry.series.includes(prefix),
    );
  }

  /** Префикс — «Серия» одного реестра: повтор — у реестра проекта или у объявившего позже */
  private reportSeries(into: DocReport): void {
    const prefixes = new Set(
      this.placed.flatMap(({ registry }) => registry.series),
    );
    for (const prefix of prefixes) {
      const [first, ...others] = this.owners(prefix);
      if (first === undefined) continue;
      const reported = new Set<Placed>();
      for (const other of others) {
        const [at, peer] =
          other.source.project || !first.source.project
            ? [other, first]
            : [first, other];
        if (reported.has(at)) continue;
        reported.add(at);
        into.add(
          'DOC-06',
          this.pathOf(at.source, at.registry.path),
          at.registry.line,
          `серия ${prefix} объявлена и в ${this.where(peer)}: префикс — у одного реестра, держатель чужих записей пишет «Архив» \`${prefix}-<n>\` (${RULE})`,
        );
      }
    }
  }

  /**
   * Один ID — одна запись: повтор между реестрами проекта и номер, который
   * есть и у владельца серии, и у держателя её архива.
   */
  private reportRecords(into: DocReport): void {
    const reported = new Set<DocRecord>();
    const first = new Map<string, Placed & { readonly found: DocFound }>();
    for (const placed of this.placed) {
      if (!placed.source.project) continue;
      for (const record of placed.registry.records) {
        const found = { source: placed.source, record };
        const key = `${record.prefix}-${record.number}`;
        const earlier = first.get(key);
        if (earlier === undefined) {
          first.set(key, { ...placed, found });
        } else if (earlier.registry !== placed.registry) {
          reported.add(record);
          this.repeat(into, found, earlier.found);
        }
      }
    }
    for (const holder of this.placed) {
      const prefixes = holder.registry.archive
        .filter((item) => item.kind === 'series')
        .map((item) => item.prefix);
      for (const record of holder.registry.records) {
        if (!prefixes.includes(record.prefix)) continue;
        const owned = this.owners(record.prefix).flatMap(
          ({ source, registry }) =>
            registry.records
              .filter((item) => item.number === record.number)
              .map((item) => ({ source, record: item })),
        );
        const [owner] = owned;
        if (owner === undefined) continue;
        const held = { source: holder.source, record };
        const [at, peer] =
          held.source.project || !owner.source.project
            ? [held, owner]
            : [owner, held];
        if (reported.has(at.record)) continue;
        reported.add(at.record);
        this.repeat(into, at, peer);
      }
    }
  }

  private repeat(into: DocReport, at: DocFound, peer: DocFound): void {
    into.add(
      'DOC-06',
      this.pathOf(at.source, at.record.path),
      at.record.line,
      `запись ${at.record.id} есть и в ${this.pathOf(peer.source, peer.record.path)}:${peer.record.line} (${peer.source.name}): ID — одна запись (${RULE})`,
    );
  }

  private where({ source, registry }: Placed): string {
    return `${this.pathOf(source, registry.path)}:${registry.line} (${source.name})`;
  }
}
