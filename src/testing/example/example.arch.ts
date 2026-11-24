import { join } from 'node:path';
import type { ArchApp } from '#core/arch/arch-checker';
import { ExampleGraph } from './example.graph';

/**
 * Учебное приложение для `arch:check` (D-45, D-97, D-107, D-108): проект —
 * `example/`, слои — `platform/{kernel,domain/<m>}`, `backend/<m>`,
 * `runners/{assembly,cli}`; вход модуля — `contract.ts`. Состав — из входа
 * графа `ExampleGraph` (`graphEntry`; единиц нет). Файл лежит вне слоёв.
 */
export const ExampleArch: ArchApp = {
  ...ExampleGraph,
  entry: 'contract',
  project: import.meta.dir,
  layout: {
    kernel: join(import.meta.dir, 'platform', 'kernel'),
    domain: join(import.meta.dir, 'platform', 'domain', '{m}'),
    backend: join(import.meta.dir, 'backend', '{m}'),
    assembly: join(import.meta.dir, 'runners', 'assembly'),
  },
  runners: [join(import.meta.dir, 'runners', 'cli')],
  graphEntry: join(import.meta.dir, 'example.graph.ts'),
};
