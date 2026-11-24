import { join } from 'node:path';
import type { ArchApp } from '#core/arch/index';
import { ExampleArch } from './example.arch';
import { ScreenGraph } from './screen/screen.graph';

/**
 * Проверки примера плюс поставщик «экран» и его слои `screen` и `screen-code`
 * (D-97, D-107, D-110); раскладка не дублируется; вход графа — свой
 * (`screen.graph.ts`), не унаследованный от примера. Файл лежит вне каталогов
 * слоёв: слой не видит файлов вне слоёв.
 */
export const ScreenArch: ArchApp = {
  ...ExampleArch,
  ...ScreenGraph,
  layers: {
    screen: [join(import.meta.dir, 'screen')],
    'screen-code': [join(import.meta.dir, 'screen-code', '{m}')],
  },
  graphEntry: join(import.meta.dir, 'screen', 'screen.graph.ts'),
};
