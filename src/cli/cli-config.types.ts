import type { GenLayoutSettings } from '../gen/layout';
import type { RoleTarget } from '../gen/project-config.types';

/** Полные настройки доставки (`.dmg/config.json` со значениями по умолчанию) */
export interface CliSettings {
  skills: { names: string[]; dirs: string[] };
  roles: {
    names: string[];
    targets: RoleTarget[];
    /** Ссылки ролей на знания проекта; нет в конфиге — поля нет */
    refs?: ReadonlyMap<string, readonly string[]>;
  };
  /** Файл инструкций агентов для вставки; null — не вставлять */
  instructions: string | null;
  /** Раскладка модулей для `dmg-core gen` */
  gen: GenLayoutSettings;
}
