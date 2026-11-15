import type * as v from 'valibot';

/** Описание вида без схемы свойств — запись в `Graph.providers` и в шапке документа. */
export type GraphKindInfo = {
  readonly kind: string;
  readonly label: string;
  readonly description: string;
};

export type GraphKindSpec = GraphKindInfo & {
  readonly props?: v.GenericSchema<Record<string, unknown>>;
};

export type GraphKinds = {
  readonly nodes: readonly GraphKindSpec[];
  readonly edges: readonly GraphKindSpec[];
};

export type RegisteredKind = GraphKindSpec & { readonly provider: string };
