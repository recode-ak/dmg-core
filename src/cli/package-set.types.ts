import type { PackageSource, SkillFiles } from './package-source';
import type { Role } from './role';

/** Скил объединения поставки и пакет-владелец */
export interface OwnedSkill {
  files: SkillFiles;
  owner: PackageSource;
}

/** Роль объединения поставки и пакет-владелец */
export interface OwnedRole {
  role: Role;
  owner: PackageSource;
}
