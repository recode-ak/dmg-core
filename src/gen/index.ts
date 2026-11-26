// dmg-core/gen — конфиг и раскладка проекта (один источник путей для `gen` и
// `arch:check`) и контракт вида `gen` пакета-поставщика: план файлов, ошибка ввода.

export { GenError } from './gen-error';
export type {
  GenContext,
  GenProvider,
  GenProviderKind,
} from './gen-provider.types';
export { GenLayout, type GenLayoutSettings } from './layout';
export type { LayerPackage, ModulePackage } from './layout.types';
export type {
  GenPlan,
  PlannedDependency,
  PlannedEdit,
  PlannedFile,
} from './plan';
export { ProjectConfig, ProjectConfigError } from './project-config';
export type {
  DocsExempt,
  DocsLimits,
  DocsSection,
  LayerPlace,
  RolesSection,
  RoleTarget,
  SkillsSection,
} from './project-config.types';
