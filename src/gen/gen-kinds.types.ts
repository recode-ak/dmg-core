import type { GenProviderKind } from './gen-provider.types';

/** Виды одного поставщика; owner — имя его пакета */
export type ProvidedKinds = {
  readonly owner: string;
  readonly kinds: readonly GenProviderKind[];
};

/** Вид поставщика с владельцем */
export type OwnedKind = {
  readonly owner: string;
  readonly kind: GenProviderKind;
};
