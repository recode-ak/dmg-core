/** Импорт файла: как записан (`spec`) и куда разрешился (`target`). */
export type ResolvedImport = { readonly spec: string; readonly target: string };

/** Импорт файла как записан; `target` — `undefined`, если пакет не разрешился. */
export type SourceImport = {
  readonly spec: string;
  readonly target: string | undefined;
};
