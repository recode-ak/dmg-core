import type { GenLayout } from './layout';
import type { GenPlan } from './plan';

/**
 * Что ядро `gen` передаёт виду поставщика. Объект, а не голая раскладка:
 * новое поле добавляется без смены сигнатуры `plan`.
 */
export type GenContext = {
  /** Места `gen` и `layers` проекта; корень — `layout.root` */
  readonly layout: GenLayout;
};

/** Вид `dmg-core gen <name> …`, объявленный пакетом-поставщиком */
export type GenProviderKind = {
  /** Имя вида в kebab-case */
  readonly name: string;
  /** Аргументы вида для подсказки: «<модуль>» */
  readonly usage: string;
  /**
   * План файлов по позиционным аргументам после имени вида (флаги — у ядра).
   * Аргументы вид разбирает сам; ошибка ввода — `GenError`.
   */
  plan(args: readonly string[], context: GenContext): GenPlan;
};

/** Экспорт `gen` входа `<пакет>/dmg-core`: виды поставщика */
export type GenProvider = {
  readonly kinds: readonly GenProviderKind[];
};
