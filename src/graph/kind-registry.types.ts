import type * as v from 'valibot';

export type GraphKindSpec = {
  readonly kind: string;
  readonly label: string;
  readonly description: string;
  readonly props?: v.GenericSchema<Record<string, unknown>>;
};

export type GraphKinds = {
  readonly nodes: readonly GraphKindSpec[];
  readonly edges: readonly GraphKindSpec[];
};

export type RegisteredKind = GraphKindSpec & { readonly provider: string };
