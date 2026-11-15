import type { ArchApp } from '#core/arch/index';
import { ExampleArch } from '../example.arch';
import { ScreenGraph } from './screen.graph';

/** Проверки примера плюс поставщик «экран»; раскладка не дублируется (D-97). */
export const ScreenArch: ArchApp = { ...ExampleArch, ...ScreenGraph };
