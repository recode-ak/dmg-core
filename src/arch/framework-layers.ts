// Слои фреймворка для проверки импортов (D-106, D-107); данные, как
// `DOMAIN_KINDS`. Каталоги — из `FrameworkDirs` (`GenLayout.dirs()`).
import type { LayerAccess, SourceLayer } from '../graph/source-layer.types';

const domainEntry: LayerAccess = { layer: 'domain', entries: ['public'] };

/**
 * Слои фреймворка по осям: платформа приложения, реализации, раннеры (D-107).
 * Доступ к домену из сборки и раннера — с ID своего слоя (ARC-07/08), из
 * домена и реализации — ARC-04 и только по `dependsOn`.
 */
export const FRAMEWORK_LAYERS: readonly SourceLayer[] = [
  { name: 'kernel', axis: 'platform', rule: 'ARC-02', sees: [] },
  {
    name: 'domain',
    axis: 'platform',
    perModule: true,
    rule: 'ARC-02',
    sees: [
      { layer: 'kernel' },
      { ...domainEntry, others: 'dependsOn', rule: 'ARC-04' },
    ],
    testEntry: true,
  },
  {
    name: 'backend-app',
    axis: 'implementation',
    rule: 'ARC-06',
    sees: [{ layer: 'kernel' }, domainEntry],
  },
  {
    name: 'backend',
    axis: 'implementation',
    perModule: true,
    rule: 'ARC-06',
    sees: [
      { layer: 'kernel' },
      { layer: 'backend-app' },
      {
        ...domainEntry,
        own: ['index', 'public'],
        others: 'dependsOn',
        rule: 'ARC-04',
      },
    ],
  },
  {
    name: 'assembly',
    axis: 'runner',
    rule: 'ARC-07',
    sees: [
      { layer: 'kernel' },
      domainEntry,
      { layer: 'backend-app' },
      { layer: 'backend', entries: ['index'] },
    ],
  },
  {
    name: 'runner',
    axis: 'runner',
    rule: 'ARC-08',
    sees: [{ layer: 'assembly' }, { layer: 'kernel' }, domainEntry],
  },
];

/**
 * Что видит файл проекта вне слоёв (D-107): всё, а модуль домена — только
 * через вход (ARC-04, без `dependsOn`: владельца нет). Реализации не
 * ограничены — вход модуля (`contract`) есть только у домена.
 */
export const OUTSIDE_ACCESS: readonly (LayerAccess & {
  readonly rule: string;
})[] = [{ ...domainEntry, rule: 'ARC-04' }];

/** Слои реализаций: слою поставщика недоступны ни в `sees`, ни в `seenBy` (ARC-13). */
export const IMPLEMENTATION_LAYERS: readonly string[] = FRAMEWORK_LAYERS.filter(
  (l) => l.axis === 'implementation',
).map((l) => l.name);
