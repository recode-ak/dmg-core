import { GraphError } from './graph-error';

/**
 * `id` узла графа — путь от корня (D-92): сегменты через `/`, родитель — `id`
 * без последнего сегмента. Порядок — посегментный, по кодовым единицам:
 * `a` < `a/b` < `a-b`, поэтому строки `id` целиком не сравниваются.
 */
export class GraphId {
  private static readonly SEPARATOR = '/';
  private static readonly SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

  private constructor(readonly segments: readonly string[]) {}

  static parse(text: string): GraphId {
    const segments = text.split(GraphId.SEPARATOR);
    for (const segment of segments) {
      if (!GraphId.isSegment(segment)) {
        throw new GraphError(
          'invalid-id',
          `Невалидный id «${text}»: сегмент «${segment}» не по правилу ${GraphId.SEGMENT.source}`,
        );
      }
    }
    return new GraphId(segments);
  }

  static root(segment: string): GraphId {
    return new GraphId([GraphId.checked(segment)]);
  }

  /** Правило сегмента; ему же подчиняется имя вида узла и ребра. */
  static isSegment(text: string): boolean {
    return GraphId.SEGMENT.test(text);
  }

  /** Глубина приставки и подъёма — целое ≥ 1. */
  static isDepth(depth: number): boolean {
    return Number.isInteger(depth) && depth >= 1;
  }

  /** Канонический порядок `id`; правило сегмента не проверяет. */
  static compare(a: string, b: string): number {
    const left = a.split(GraphId.SEPARATOR);
    const right = b.split(GraphId.SEPARATOR);
    for (const [index, segment] of left.entries()) {
      const other = right[index];
      if (other === undefined) return 1;
      if (segment !== other) return segment < other ? -1 : 1;
    }
    return left.length - right.length;
  }

  private static checked(segment: string): string {
    if (!GraphId.isSegment(segment)) {
      throw new GraphError(
        'invalid-id',
        `Невалидный сегмент id «${segment}»: не по правилу ${GraphId.SEGMENT.source}`,
      );
    }
    return segment;
  }

  child(segment: string): GraphId {
    return new GraphId([...this.segments, GraphId.checked(segment)]);
  }

  parent(): GraphId | undefined {
    if (this.segments.length === 1) return undefined;
    return new GraphId(this.segments.slice(0, -1));
  }

  /** От родителя к корню. */
  ancestors(): readonly GraphId[] {
    const parent = this.parent();
    return parent ? [parent, ...parent.ancestors()] : [];
  }

  /** Первые `depth` сегментов; `id` короче — он сам. */
  prefix(depth: number): GraphId {
    if (!GraphId.isDepth(depth)) {
      throw new GraphError(
        'invalid-depth',
        `Глубина приставки id «${this}» — целое ≥ 1, получено ${depth}`,
      );
    }
    if (depth >= this.segments.length) return this;
    return new GraphId(this.segments.slice(0, depth));
  }

  /** Тот же путь под приставкой: `shop/food` под `chain` — `chain/shop/food`. */
  under(prefix: GraphId): GraphId {
    return new GraphId([...prefix.segments, ...this.segments]);
  }

  toString(): string {
    return this.segments.join(GraphId.SEPARATOR);
  }
}
