import { describe, expect, it } from 'bun:test';
import { AppDef, type AppSpec } from '../domain/contracts/app-def';
import { ModuleDef } from '../domain/contracts/module-def';
import { AppDefChecker } from './app-def-checker';
import { AlphaModuleDef, BetaModuleDef } from './arch.fixture';

const app = (spec: {
  name?: string;
  label?: string;
  description?: string;
  modules: AppSpec['modules'];
}) =>
  AppDef.define({
    name: 'school',
    label: 'Школа',
    description: 'Приложение школы.',
    ...spec,
  });

const check = (def: ReturnType<typeof app>): string[] =>
  new AppDefChecker(def).check().map((v) => v.format());

const todos = (def: ReturnType<typeof app>): string[] =>
  new AppDefChecker(def).todos().map((v) => v.format());

describe('AppDefChecker', () => {
  describe('MAN-01 — тексты приложения', () => {
    it('заполненные тексты — без нарушений и предупреждений', () => {
      const def = app({ modules: [AlphaModuleDef, BetaModuleDef] });
      expect(check(def)).toEqual([]);
      expect(todos(def)).toEqual([]);
    });

    it('пустой label — нарушение', () => {
      expect(
        check(app({ label: '', modules: [AlphaModuleDef, BetaModuleDef] })),
      ).toEqual(['MAN-01: приложение school: пустой label']);
    });

    it('пустой description — нарушение', () => {
      expect(
        check(
          app({ description: '  ', modules: [AlphaModuleDef, BetaModuleDef] }),
        ),
      ).toEqual(['MAN-01: приложение school: пустой description']);
    });

    it('TODO в текстах — предупреждения, а не нарушения', () => {
      const def = app({
        label: 'TODO: название приложения',
        description: 'TODO: что делает приложение',
        modules: [AlphaModuleDef, BetaModuleDef],
      });
      expect(check(def)).toEqual([]);
      expect(todos(def)).toEqual([
        'MAN-01: приложение school: label не заполнен — «TODO: название приложения»',
        'MAN-01: приложение school: description не заполнен — «TODO: что делает приложение»',
      ]);
    });
  });

  describe('MAN-15 — состав приложения', () => {
    it('полный состав, зависимости внутри — без нарушений', () => {
      expect(check(app({ modules: [AlphaModuleDef, BetaModuleDef] }))).toEqual(
        [],
      );
    });

    it('пустой состав — без нарушений', () => {
      expect(check(app({ modules: [] }))).toEqual([]);
    });

    it('повтор модуля по ссылке — нарушение', () => {
      expect(check(app({ modules: [BetaModuleDef, BetaModuleDef] }))).toEqual([
        'MAN-15: приложение school: модуль beta в составе дважды',
      ]);
    });

    it('повтор модуля по имени (разные Def) — нарушение', () => {
      const twin = ModuleDef.define({
        name: 'beta',
        label: 'Каталог-двойник',
        description: 'Другой Def с тем же именем.',
        dependsOn: [],
        aggregates: [],
        useCases: [],
        reactions: [],
        jobs: [],
      });
      expect(check(app({ modules: [BetaModuleDef, twin] }))).toEqual([
        'MAN-15: приложение school: модуль beta в составе дважды',
      ]);
    });

    it('не-external модуль из dependsOn вне состава — нарушение', () => {
      expect(check(app({ modules: [AlphaModuleDef] }))).toEqual([
        'MAN-15: приложение school: модуль beta нужен модулю alpha (dependsOn), но не входит в состав',
      ]);
    });

    it('dependsOn на двойника с тем же именем — «не входит в состав» нет', () => {
      const twin = ModuleDef.define({
        name: 'beta',
        label: 'Каталог-двойник',
        description: 'Другой Def с тем же именем.',
        dependsOn: [],
        aggregates: [],
        useCases: [],
        reactions: [],
        jobs: [],
      });
      const user = ModuleDef.define({
        name: 'user',
        label: 'Потребитель',
        description: 'Зависит от beta.',
        dependsOn: [BetaModuleDef],
        aggregates: [],
        useCases: [],
        reactions: [],
        jobs: [],
      });
      expect(
        check(app({ modules: [twin, user] })).filter((v) =>
          v.includes('не входит в состав'),
        ),
      ).toEqual([]);
    });

    it('external модуль вне состава — не нарушение', () => {
      const outer = ModuleDef.define({
        name: 'outer',
        label: 'Внешний',
        description: 'Реализован вне приложения.',
        external: true,
        dependsOn: [],
        aggregates: [],
        useCases: [],
        reactions: [],
        jobs: [],
      });
      const user = ModuleDef.define({
        name: 'user',
        label: 'Потребитель',
        description: 'Зависит от внешнего модуля.',
        dependsOn: [outer],
        aggregates: [],
        useCases: [],
        reactions: [],
        jobs: [],
      });
      expect(
        check(
          AppDef.define({
            name: 'school',
            label: 'Школа',
            description: 'Приложение школы.',
            modules: [user],
          }),
        ),
      ).toEqual([]);
    });

    it('имя приложения — не сегмент id графа — нарушение', () => {
      expect(check(app({ name: '@acme/school', modules: [] }))).toEqual([
        'MAN-15: приложение @acme/school: имя не сегмент id графа',
      ]);
    });
  });
});
