import { type GenKind, OWN_KINDS, USAGE } from './cli';
import type { OwnedKind, ProvidedKinds } from './gen-kinds.types';
import { ProjectConfig, ProjectConfigError } from './project-config';

/** Владелец своих видов */
const CORE = 'dmg-core';

const PROVIDED_USAGE =
  'Виды поставщиков (dmg-core gen <вид> <аргументы> [--write] [--dry-run] [--adopt]):';

/**
 * Каталог видов `dmg-core gen`: свои виды `dmg-core` и виды поставщиков в
 * порядке `providers`, у каждого имени — один владелец. Совпадение имени —
 * `ProjectConfigError` в конструкторе, как у скилов и ролей: каталог
 * собирается целиком до разбора команды.
 */
export class GenKinds {
  private readonly provided = new Map<string, OwnedKind>();

  constructor(provided: readonly ProvidedKinds[] = []) {
    const owners = new Map<string, string>(
      OWN_KINDS.map((name) => [name, CORE]),
    );
    for (const { owner, kinds } of provided) {
      for (const kind of kinds) {
        const had = owners.get(kind.name);
        if (had !== undefined) {
          throw new ProjectConfigError(
            `${ProjectConfig.file}: providers — вид «${kind.name}» есть у ${had} и ${owner}`,
          );
        }
        owners.set(kind.name, owner);
        this.provided.set(kind.name, { owner, kind });
      }
    }
  }

  /** Свой вид — его имя; вид поставщика — с владельцем; нет — undefined */
  find(name: string): GenKind | OwnedKind | undefined {
    const own = OWN_KINDS.find((kind) => kind === name);
    return own ?? this.provided.get(name);
  }

  /** Без видов поставщиков — подсказка своих видов как есть */
  usage(): string {
    if (this.provided.size === 0) return USAGE;
    const lines = [...this.provided.values()].map(({ owner, kind }) => {
      const call = kind.usage === '' ? kind.name : `${kind.name} ${kind.usage}`;
      return `  ${call} — ${owner}`;
    });
    return [USAGE, PROVIDED_USAGE, ...lines].join('\n');
  }
}
