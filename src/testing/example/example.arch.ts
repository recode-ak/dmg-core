import { join } from 'node:path';
import type { ArchApp } from '#core/arch/arch-checker';
import { ExampleGraph } from './example.graph';

/**
 * Учебное приложение для `arch:check` (D-45, D-97): домен —
 * `example/platform/domain/<m>`, прикладной слой — `example/backend/<m>`, вход
 * модуля — `contract.ts`. Корень сборки — `example/runners/assembly`, раннер —
 * `example/runners/cli`; состав — из входа графа (`ExampleGraph`).
 */
export const ExampleArch: ArchApp = {
  ...ExampleGraph,
  entry: 'contract',
  layout: (m) => ({
    domain: join(import.meta.dir, 'platform', 'domain', m),
    backend: join(import.meta.dir, 'backend', m),
  }),
  root: join(import.meta.dir, 'runners', 'assembly'),
  runners: [join(import.meta.dir, 'runners', 'cli')],
};
