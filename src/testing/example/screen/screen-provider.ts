import {
  DomainIds,
  type GraphContribution,
  type GraphKinds,
  type GraphNodeInput,
  type GraphProvider,
  type GraphRule,
  type LayerAccess,
  type SourceLayer,
} from '#core/graph/index';
import type { AnyAppDef } from '#core/index';
import type { AnyScreenDef } from './screen-def.types';
import { SCREEN_KINDS, SCREEN_PROVIDER, SCREEN_ROOT } from './screen-kinds';
import { ScreenWithoutUcRule } from './screen-rule';

/**
 * Поставщик «экран»: корень `example-ui`, узел на экран, рёбра `uses` к UC и
 * `listens` к событиям. Ссылки на домен — только через `DomainIds`.
 */
export class ScreenProvider implements GraphProvider {
  readonly name = SCREEN_PROVIDER;
  readonly version = '1.0.0';

  constructor(
    readonly app: AnyAppDef,
    readonly screens: readonly AnyScreenDef[],
  ) {}

  kinds(): GraphKinds {
    return SCREEN_KINDS;
  }

  contribute(): GraphContribution {
    const ids = new DomainIds(this.app);
    return {
      nodes: [
        ScreenProvider.rootNode(),
        ...this.screens.map(ScreenProvider.node),
      ],
      edges: this.screens.flatMap((screen) => {
        const from = ScreenProvider.id(screen);
        return [
          ...screen.uses.map((uc) => ({
            kind: 'uses',
            from,
            to: ids.operation(uc),
          })),
          ...screen.listens.map((e) => ({
            kind: 'listens',
            from,
            to: ids.event(e),
          })),
        ];
      }),
    };
  }

  rules(): readonly GraphRule[] {
    return [new ScreenWithoutUcRule()];
  }

  /**
   * Слои образца (D-107, D-110): описание `screen` и исполнение
   * `screen-code`, модуль которого — экран. Сессия — в описании: здесь классы
   * поставщика — его «пакет», у потребителя он из npm и слоями не проверяется.
   */
  layers(): readonly SourceLayer[] {
    const domain: LayerAccess = { layer: 'domain', entries: ['public'] };
    return [
      {
        name: 'screen',
        axis: 'platform',
        rule: 'SCR-02',
        sees: [{ layer: 'kernel' }, domain],
      },
      {
        name: 'screen-code',
        axis: 'implementation',
        rule: 'SCR-03',
        perModule: this.screens.map((s) => s.name),
        entry: 'public',
        sees: [
          { layer: 'screen' },
          { layer: 'kernel' },
          domain,
          { layer: 'screen-code', entries: ['public'] },
        ],
      },
    ];
  }

  private static id(screen: AnyScreenDef): string {
    return `${SCREEN_ROOT}/${screen.name}`;
  }

  private static rootNode(): GraphNodeInput {
    return {
      kind: 'uiApp',
      id: SCREEN_ROOT,
      label: 'Приложение UI',
      description: 'Экраны учебного приложения; не часть доменного приложения.',
      visible: false,
      props: {},
    };
  }

  private static node(screen: AnyScreenDef): GraphNodeInput {
    const { label, description, visible } = screen;
    return {
      kind: 'screen',
      id: ScreenProvider.id(screen),
      label,
      description,
      visible,
      props: {},
    };
  }
}
