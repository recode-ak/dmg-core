import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { GenProviderKind } from '../gen/gen-provider.types';
import { isKebab } from '../gen/naming';
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

/** Экспорт входа до проверки формы */
type Entry = { gen?: unknown };

/**
 * Установленный пакет-поставщик: корень и вход `<имя>/dmg-core`. Поиск
 * (`find`) идёт через вход без загрузки его кода; `kinds()` загружает вход.
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

  /**
   * Виды `gen` входа; нет экспорта `gen` — видов нет. Форма — по признакам,
   * а не `instanceof`: вход импортирует свою копию `dmg-core`.
   */
  async kinds(): Promise<readonly GenProviderKind[]> {
    const { gen } = await this.load();
    if (gen === undefined) return [];
    const kinds = (gen as { kinds?: unknown } | null)?.kinds;
    if (!Array.isArray(kinds) || !kinds.every(ProviderPackage.isKind)) {
      throw ProviderError.supply(
        this.name,
        `вход ${this.name}/dmg-core — gen: нужен { kinds: [{ name, usage, plan }] }`,
      );
    }
    const names = new Set<string>();
    for (const { name } of kinds) {
      if (!isKebab(name)) {
        throw ProviderError.supply(
          this.name,
          `вид «${name}» — имя в kebab-case (a-z, 0-9, дефисы)`,
        );
      }
      if (names.has(name)) {
        throw ProviderError.supply(this.name, `вид «${name}» объявлен дважды`);
      }
      names.add(name);
    }
    return kinds;
  }

  private async load(): Promise<Entry> {
    try {
      return await import(this.entry);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw ProviderError.supply(
        this.name,
        `вход ${this.name}/dmg-core не загружается — ${reason}`,
      );
    }
  }

  private static isKind(kind: unknown): kind is GenProviderKind {
    const { name, usage, plan } = (kind ?? {}) as Record<string, unknown>;
    return (
      typeof name === 'string' &&
      typeof usage === 'string' &&
      typeof plan === 'function'
    );
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
