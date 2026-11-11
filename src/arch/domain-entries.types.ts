/**
 * Запрещённый импорт домена модуля: `testing` — вход фикстур из рабочего кода
 * (TST-07), иначе — мимо входа (правило слоя: ARC-04, ARC-07, ARC-08).
 */
export type EntryMisuse = {
  readonly testing: boolean;
  readonly message: string;
};
