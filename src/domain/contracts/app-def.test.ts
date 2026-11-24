import { describe, expect, expectTypeOf, it } from 'bun:test';
import { Def } from '../../index';
import { AppDef } from './app-def';
import { TodoModuleDef, UserArDef } from './contracts.fixture';
import { ModuleDef } from './module-def';

const Users = ModuleDef.define({
  name: 'users',
  label: 'Пользователи',
  description: 'Учётные записи.',
  dependsOn: [],
  aggregates: [UserArDef],
  useCases: [],
  reactions: [],
  jobs: [],
});

const texts = { label: 'Школа', description: 'Описание школы.' };

const School = AppDef.define({
  name: 'school',
  ...texts,
  modules: [TodoModuleDef, Users],
});

describe('AppDef', () => {
  it('вид app: наследник Def, литерал имени сохраняется', () => {
    expect(School).toBeInstanceOf(AppDef);
    expect(School).toBeInstanceOf(Def);
    expect(School.dmg).toBe('app');
    expect(School.name).toBe('school');
    expectTypeOf(School.name).toEqualTypeOf<'school'>();
  });

  it('define хранит модули ссылками, масштаб по умолчанию не задан', () => {
    expect(School.modules[0]).toBe(TodoModuleDef);
    expect(School.modules[1]).toBe(Users);
    expect(School.scale).toBeUndefined();
  });

  it('normalize() — ровно dmg, тексты, visible, modules; модули именами по порядку', () => {
    const form = School.normalize();
    expect(Object.keys(form)).toEqual([
      'dmg',
      'name',
      'label',
      'description',
      'visible',
      'modules',
    ]);
    expect(form).toEqual({
      dmg: 'app',
      name: 'school',
      ...texts,
      visible: false,
      modules: ['todo', 'users'],
    });
  });

  it('normalize() со scale — ключ scale между visible и modules', () => {
    const city = AppDef.define({
      name: 'city',
      ...texts,
      scale: 'город',
      modules: [Users],
    });
    expect(city.scale).toBe('город');
    expect(Object.keys(city.normalize())).toEqual([
      'dmg',
      'name',
      'label',
      'description',
      'visible',
      'scale',
      'modules',
    ]);
    expect(city.normalize()).toMatchObject({ scale: 'город' });
  });

  it('visible: по умолчанию false, из спеки — true', () => {
    expect(School.visible).toBe(false);
    const shown = AppDef.define({
      name: 'shown',
      ...texts,
      visible: true,
      modules: [],
    });
    expect(shown.visible).toBe(true);
    expect(shown.normalize()).toMatchObject({ visible: true });
  });
});
