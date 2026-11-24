/**
 * Реестр долга кода как вход `arch:check` (D-111): отступления от правил
 * слоёв поставщика. `root` — абсолютный корень путей Места (корень репо),
 * `code` — путь реестра от `root`, `idPrefix` — `DEBT` или `<X>-DEBT`.
 */
export type ArchDebt = {
  readonly root: string;
  readonly code: string;
  readonly idPrefix: string;
};

/** Реестр отступлений приложения; нет — нарушения слоёв не снимаются. */
export type DebtPlaces = {
  readonly debt?: ArchDebt;
};

/**
 * Чистый вход сопоставления: текст реестра, префикс ID, корень путей Места и
 * абсолютные пути файлов проекта (по ним Место узнаёт своё приложение).
 */
export type DeviationInput = {
  readonly md: string;
  readonly idPrefix: string;
  readonly root: string;
  readonly files: readonly string[];
};
