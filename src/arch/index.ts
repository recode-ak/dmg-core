// dmg-core/arch — контрактные проверки архитектуры (`bun run arch:check`).

export { type ArchApp, ArchChecker } from './arch-checker';
export {
  type ArchReportOptions,
  RULES_DOC,
  reportArchCheck,
} from './arch-report';
export { DebtChecker } from './debt-checker';
export type {
  DebtCheckerOptions,
  DebtInput,
  DebtLayout,
  DebtRegistries,
  DebtRegistryPaths,
  SourceFile,
} from './debt-checker.types';
export type { ArchDebt } from './deviation-registry.types';
export type { ModuleLayout } from './file-checker';
export type { FrameworkDirs } from './layer-checker.types';
export {
  type ArchRule,
  PACKAGE_RULE_PREFIXES,
  Violation,
} from './violation';
