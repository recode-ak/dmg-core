import type { GraphKinds } from '#core/graph/index';

/** Имя поставщика «экран» в документе графа. */
export const SCREEN_PROVIDER = 'example-screen';

/** Корень приложения UI: оно не часть доменного приложения. */
export const SCREEN_ROOT = 'example-ui';

/** Виды узлов и рёбер поставщика «экран»; данные, как `DOMAIN_KINDS`. */
export const SCREEN_KINDS: GraphKinds = {
  nodes: [
    {
      kind: 'uiApp',
      label: 'Приложение UI',
      description: 'Корень экранов: приложение UI вне доменного приложения.',
    },
    {
      kind: 'screen',
      label: 'Экран',
      description: 'Экран приложения UI: вызывает UC и слушает события.',
    },
  ],
  edges: [
    {
      kind: 'uses',
      label: 'Вызывает UC',
      description: 'Экран объявил UC, который вызывает.',
    },
    {
      kind: 'listens',
      label: 'Слушает событие',
      description: 'Экран объявил событие, которое слушает.',
    },
  ],
};
