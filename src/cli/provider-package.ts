import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { ProjectConfig } from '../gen/project-config';

/** Ошибка поставщика из `providers` — сообщение пользователю, без стека */
export class ProviderError extends Error {
  /** Ошибка в поставке пакета name */
  static supply(name: string, detail: string): ProviderError {
    return new ProviderError(`Ошибка поставки ${name}: ${detail}`);
  }

  /** Ошибка списка `providers` конфига проекта */
  static config(detail: string): ProviderError {
    return new ProviderError(`${ProjectConfig.file}: providers — ${detail}`);
  }
}

/** Поля package.json, по которым узнаётся корень поставщика */
type Manifest = { name?: unknown };

/**
 * Установленный пакет-поставщик: корень и вход `<имя>/dmg-core`.
 * Ищется от корня проекта через вход, код входа не загружается.
 */
export class ProviderPackage {
  private constructor(
    readonly name: string,
    readonly root: string,
    readonly entry: string,
  ) {}

  /** Вход — `Bun.resolveSync`; корень — ближайший над входом package.json с этим name */
  static async find(
    name: string,
    projectRoot: string,
  ): Promise<ProviderPackage> {
    const entry = ProviderPackage.entry(name, resolve(projectRoot));
    for (let dir = dirname(entry); ; dir = dirname(dir)) {
      if ((await ProviderPackage.manifest(dir))?.name === name) {
        return new ProviderPackage(name, dir, entry);
      }
      if (dirname(dir) === dir) break;
    }
    throw ProviderError.supply(
      name,
      `над входом ${name}/dmg-core нет package.json с name «${name}»`,
    );
  }

  private static entry(name: string, projectRoot: string): string {
    try {
      return Bun.resolveSync(`${name}/dmg-core`, projectRoot);
    } catch {
      throw ProviderError.config(
        `пакет «${name}» не найден от корня проекта (нет входа ${name}/dmg-core)`,
      );
    }
  }

  /** package.json каталога; нет или не JSON — undefined (ищем выше) */
  private static async manifest(dir: string): Promise<Manifest | undefined> {
    try {
      return JSON.parse(
        await readFile(join(dir, 'package.json'), 'utf8'),
      ) as Manifest;
    } catch {
      return undefined;
    }
  }
}
