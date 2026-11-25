// dmg-core/gen — конфиг и раскладка проекта: один источник путей для `gen` и `arch:check`.

export { GenLayout, type GenLayoutSettings } from './layout';
export type { ModulePackage } from './layout.types';
export { ProjectConfig, ProjectConfigError } from './project-config';
export type {
  LayerPlace,
  RolesSection,
  RoleTarget,
  SkillsSection,
} from './project-config.types';
