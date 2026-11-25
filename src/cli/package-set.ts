import type { OwnedRole, OwnedSkill } from './package-set.types';
import type { PackageSource } from './package-source';
import { ProviderError } from './provider-package';

/**
 * Поставка проекту: `dmg-core` и поставщики из `providers`, у каждого скила и
 * роли — один владелец. Совпадение имени (по всему содержимому пакетов, до
 * фильтров `names`) — `ProviderError`, без перезаписи. Скилы и роли — разные
 * имена.
 */
export class PackageSet {
  private readonly skills = new Map<string, OwnedSkill>();
  private readonly roles = new Map<string, OwnedRole>();

  /** Порядок — `dmg-core`, затем поставщики в порядке `providers` */
  constructor(
    readonly core: PackageSource,
    providers: readonly PackageSource[] = [],
  ) {
    for (const owner of [core, ...providers]) {
      for (const [name, files] of owner.skills) {
        PackageSet.claim(this.skills, 'скил', name, { files, owner });
      }
      for (const role of owner.roles) {
        PackageSet.claim(this.roles, 'роль', role.name, { role, owner });
      }
    }
  }

  /** Общий блок ролей — один, `dmg-core` */
  get common(): string {
    return this.core.common;
  }

  skillNames(): string[] {
    return [...this.skills.keys()];
  }

  roleNames(): string[] {
    return [...this.roles.keys()];
  }

  skill(name: string): OwnedSkill | undefined {
    return this.skills.get(name);
  }

  role(name: string): OwnedRole | undefined {
    return this.roles.get(name);
  }

  private static claim<T extends { owner: PackageSource }>(
    owned: Map<string, T>,
    kind: string,
    name: string,
    item: T,
  ): void {
    const had = owned.get(name);
    if (had) {
      throw ProviderError.config(
        `${kind} «${name}» есть у ${had.owner.name} и ${item.owner.name}`,
      );
    }
    owned.set(name, item);
  }
}
