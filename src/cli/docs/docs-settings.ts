import type { DocsLimits, DocsSection } from '../../gen/project-config.types';
import type { DocsDefaults } from './docs.types';

/**
 * Секция `docs` с умолчаниями: входы, бюджеты, исключения и генерируемые
 * места. Форму секции проверяет `ProjectConfig` (D-113), умолчания — здесь.
 * Путь с `/` на конце — каталог, всё внутри; иначе — файл; glob нет.
 * @see src/cli/docs/docs-settings.test.ts
 */
export class DocsSettings {
  static readonly defaults: DocsDefaults = {
    entries: ['llms.txt'],
    limits: { entry: 50, index: 60, leaf: 150, caption: 120 },
  };

  private constructor(
    readonly entries: readonly string[],
    readonly limits: DocsLimits,
    readonly exemptPaths: readonly string[],
    private readonly generated: readonly string[],
  ) {}

  /** Настройки секции; нет секции или поля — умолчание, `limits` — поштучно */
  static of(section: DocsSection = {}): DocsSettings {
    const { defaults } = DocsSettings;
    return new DocsSettings(
      section.entries ?? defaults.entries,
      { ...defaults.limits, ...section.limits },
      (section.exempt ?? []).map((item) => item.path),
      section.generated ?? [],
    );
  }

  isExempt(path: string): boolean {
    return DocsSettings.covered(path, this.exemptPaths);
  }

  isGenerated(path: string): boolean {
    return DocsSettings.covered(path, this.generated);
  }

  private static covered(path: string, places: readonly string[]): boolean {
    return places.some((place) =>
      place.endsWith('/') ? path.startsWith(place) : path === place,
    );
  }
}
