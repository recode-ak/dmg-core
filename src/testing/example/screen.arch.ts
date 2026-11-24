import { join } from 'node:path';
import type { ArchApp } from '#core/arch/index';
import { ExampleArch } from './example.arch';
import { ScreenGraph } from './screen/screen.graph';

/**
 * Проверки примера плюс поставщик «экран» и его слой `screen` (D-97, D-107);
 * раскладка не дублируется. Файл лежит вне каталога слоя: слой не видит файлов
 * вне слоёв.
 */
export const ScreenArch: ArchApp = {
  ...ExampleArch,
  ...ScreenGraph,
  layers: { screen: [join(import.meta.dir, 'screen')] },
};
