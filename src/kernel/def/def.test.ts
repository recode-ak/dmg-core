import { describe, expect, expectTypeOf, it } from 'bun:test';
import * as v from 'valibot';
import { Def, type DefSchemas } from './def';

/** Минимальный вид для проверки контракта базы. */
class NoteDef<const N extends string = string> extends Def<N> {
  readonly dmg = 'note';

  static define<const N extends string>(spec: {
    name: N;
    label: string;
    description: string;
  }): NoteDef<N> {
    return new NoteDef(spec);
  }

  normalize(): { readonly dmg: 'note'; readonly name: string } {
    return { dmg: this.dmg, name: this.name };
  }
}

/** Вид со схемами: дополняет `schemas()`, `describe()` берёт их сам. */
class BodyDef extends Def {
  readonly dmg = 'body';
  readonly body = v.object({ text: v.string() });

  override schemas(): DefSchemas {
    return [['body', this.body]];
  }

  normalize(): { readonly dmg: 'body' } {
    return { dmg: this.dmg };
  }
}

/** Вид без своих полей: проверка признака базы. */
class FlagDef extends Def {
  readonly dmg = 'flag';

  normalize(): { readonly dmg: 'flag' } {
    return { dmg: this.dmg };
  }
}

const note = NoteDef.define({
  name: 'draft',
  label: 'Черновик',
  description: 'Заметка без адресата.',
});

describe('Def', () => {
  it('тексты из спеки, литерал имени сохраняется', () => {
    expect(note).toBeInstanceOf(Def);
    expect(note.name).toBe('draft');
    expect(note.label).toBe('Черновик');
    expect(note.description).toBe('Заметка без адресата.');
    expectTypeOf(note.name).toEqualTypeOf<'draft'>();
  });

  it('visible: по умолчанию false, из спеки — true (D-94)', () => {
    const texts = { name: 'f', label: 'Флаг', description: 'Признак.' };
    expect(new FlagDef(texts).visible).toBe(false);
    expect(new FlagDef({ ...texts, visible: true }).visible).toBe(true);
    expect(new FlagDef({ ...texts, visible: false }).visible).toBe(false);
  });

  it('visible не входит в texts() и describe() (тексты MAN-01)', () => {
    const flag = new FlagDef({
      name: 'f',
      label: 'Флаг',
      description: 'Признак.',
      visible: true,
    });
    expect(flag.texts()).toEqual({
      name: 'f',
      label: 'Флаг',
      description: 'Признак.',
    });
    expect(flag.describe()).toEqual({
      label: 'Флаг',
      description: 'Признак.',
      schemas: [],
    });
  });

  it('texts() — имя, метка и описание для нормализованной формы', () => {
    expect(note.texts()).toEqual({
      name: 'draft',
      label: 'Черновик',
      description: 'Заметка без адресата.',
    });
  });

  it('describe() без схем по умолчанию', () => {
    expect(note.schemas()).toEqual([]);
    expect(note.describe()).toEqual({
      label: 'Черновик',
      description: 'Заметка без адресата.',
      schemas: [],
    });
  });

  it('describe() берёт схемы вида', () => {
    const body = new BodyDef({ name: 'b', label: 'Тело', description: 'Т.' });
    expect(body.describe().schemas).toEqual([['body', body.body]]);
  });

  it('normalize() — полиморфно, у каждого вида своя форма', () => {
    const defs: readonly Def[] = [
      note,
      new BodyDef({ name: 'b', label: 'Тело', description: 'Т.' }),
    ];
    const forms: unknown[] = defs.map((d) => d.normalize());
    expect(forms).toEqual([{ dmg: 'note', name: 'draft' }, { dmg: 'body' }]);
  });

  it('структурная типизация: нет private/#', () => {
    type PublicShape = { [K in keyof NoteDef]: NoteDef[K] };
    expectTypeOf<PublicShape>().toExtend<NoteDef>();
  });
});
