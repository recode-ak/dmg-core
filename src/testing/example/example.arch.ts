import { join } from 'node:path';
import type { ArchApp } from '#core/arch/arch-checker';
import { ExampleGraph } from './example.graph';

/**
 * Учебное приложение для `arch:check` (D-45): домен — `example/<m>`,
 * прикладной слой — `example/app/<m>`, вход модуля — `contract.ts`. Корень
 * сборки — `example/app`, раннер — `example/runner`; состав — из входа графа
 * (`ExampleGraph`, D-97).
 */
export const ExampleArch: ArchApp = {
  ...ExampleGraph,
  entry: 'contract',
  layout: (m) => ({
    domain: join(import.meta.dir, m),
    app: join(import.meta.dir, 'app', m),
  }),
  root: join(import.meta.dir, 'app'),
  runners: [join(import.meta.dir, 'runner')],
};
