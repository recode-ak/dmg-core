import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DirScan } from './dir-scan';
import { Marker } from './marker';
import { ProviderError, type ProviderPackage } from './provider-package';
import { Role } from './role';

/** Файлы скила: путь от каталога скила → содержимое */
export type SkillFiles = Map<string, string>;

/** Зависимости из package.json: имя → диапазон версий */
export type Dependencies = Readonly<Record<string, string>>;

/** Поля package.json `dmg-core`, которые читает поставка: свой манифест, без проверки */
type CoreManifest = {
  version: string;
  peerDependencies?: Dependencies;
  devDependencies?: Dependencies;
};

/** Поля package.json поставщика: чужой манифест, не проверен */
type ProviderManifest = { version?: unknown };

const CORE = 'dmg-core';
const COMMON = 'agents/common.md';

/**
 * Что пакет поставляет в проект: скилы, роли, общий блок ролей и версии
 * зависимостей для каркаса проекта (`peerDependencies` — зависимости
 * потребителя, `devDependencies` — инструменты его `check`). Общий блок и
 * зависимости несёт только `dmg-core`; у поставщика они пусты.
 */
export class PackageSource {
  private constructor(
    readonly name: string,
    readonly version: string,
    readonly skills: Map<string, SkillFiles>,
    readonly roles: Role[],
    readonly common: string,
    readonly peerDependencies: Dependencies,
    readonly devDependencies: Dependencies,
  ) {}

  /** Поставка `dmg-core` из корня пакета; имя — константой: метка не зависит от `name` манифеста */
  static async load(root: string): Promise<PackageSource> {
    const manifest = (await PackageSource.manifest(root)) as CoreManifest;
    const common = await readFile(join(root, COMMON), 'utf8').catch(() => '');
    return new PackageSource(
      CORE,
      manifest.version,
      await PackageSource.readSkills(root),
      await PackageSource.readRoles(root, (file, text) =>
        Role.parse(file, text),
      ),
      common,
      manifest.peerDependencies ?? {},
      manifest.devDependencies ?? {},
    );
  }

  /**
   * Поставка поставщика: скилы и роли. `agents/common.md`, нет `version`,
   * битая роль — `ProviderError`; ошибки чтения файлов — дальше.
   */
  static async provider(found: ProviderPackage): Promise<PackageSource> {
    const { name, root } = found;
    if (await Bun.file(join(root, COMMON)).exists()) {
      throw ProviderError.supply(
        name,
        `${COMMON} — общий блок ролей несёт только ${CORE}`,
      );
    }
    const { version } = (await PackageSource.manifest(
      root,
    )) as ProviderManifest;
    if (typeof version !== 'string') {
      throw ProviderError.supply(name, 'package.json без version');
    }
    const roles = await PackageSource.readRoles(root, (file, text) => {
      try {
        return Role.parse(file, text);
      } catch (error) {
        throw ProviderError.supply(name, (error as Error).message);
      }
    });
    const skills = await PackageSource.readSkills(root);
    return new PackageSource(name, version, skills, roles, '', {}, {});
  }

  /** Метка копии этого пакета */
  marker(): Marker {
    return new Marker(this.version, this.name);
  }

  /**
   * Диапазоны внешних зависимостей пакета модуля (`gen.package`) — как у
   * каркаса: dmg-core — версия пакета, valibot — его peer. Нет версии
   * valibot — её нет и здесь: о дефекте поставки сообщает `gen`.
   */
  moduleDependencies(): Record<string, string> {
    const dependencies: Record<string, string> = {
      'dmg-core': `^${this.version}`,
    };
    const valibot = this.peerDependencies.valibot;
    if (valibot !== undefined) dependencies.valibot = valibot;
    return dependencies;
  }

  private static async manifest(root: string): Promise<unknown> {
    return JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  }

  private static async readSkills(
    root: string,
  ): Promise<Map<string, SkillFiles>> {
    const skills = new Map<string, SkillFiles>();
    for (const path of await new DirScan(root).paths('skills', '**/*')) {
      const [name, ...rest] = path.split('/');
      if (!name || rest.length === 0) continue;
      const files = skills.get(name) ?? new Map<string, string>();
      files.set(
        rest.join('/'),
        await readFile(join(root, 'skills', path), 'utf8'),
      );
      skills.set(name, files);
    }
    return skills;
  }

  /** Роли `agents/roles/*.md`; parse — разбор файла роли (путь от корня пакета) */
  private static async readRoles(
    root: string,
    parse: (file: string, text: string) => Role,
  ): Promise<Role[]> {
    const roles: Role[] = [];
    for (const path of await new DirScan(root).paths('agents/roles', '*.md')) {
      const file = `agents/roles/${path}`;
      roles.push(parse(file, await readFile(join(root, file), 'utf8')));
    }
    return roles;
  }
}
