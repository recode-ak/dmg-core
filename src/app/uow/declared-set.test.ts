import { describe, expect, it } from 'bun:test';
import { DeclaredSet } from '../index';

type Item = { readonly name: string };

const a: Item = { name: 'a' };
const b: Item = { name: 'b' };

describe('DeclaredSet', () => {
  it('объявленное — has true, assert без нарушения', () => {
    const set = new DeclaredSet<Item>([a, b]);
    expect(set.has(a)).toBe(true);
    expect(() => set.assert(a, 'не должно сработать')).not.toThrow();
  });

  it('необъявленное — Error с текстом как есть', () => {
    const set = new DeclaredSet<Item>([a]);
    expect(set.has(b)).toBe(false);
    expect(() => set.assert(b, 'b не заявлено в emits')).toThrow(
      new Error('b не заявлено в emits'),
    );
  });

  it('с onViolation — обработчик получает текст, исключения нет', () => {
    const seen: string[] = [];
    const set = new DeclaredSet<Item>([a], (m) => seen.push(m));
    expect(() => set.assert(b, 'нарушение b')).not.toThrow();
    expect(seen).toEqual(['нарушение b']);
  });

  it('violate: без обработчика бросает Error, с обработчиком — вызывает его', () => {
    expect(() => new DeclaredSet<Item>([a]).violate('текст')).toThrow(
      new Error('текст'),
    );
    const seen: string[] = [];
    new DeclaredSet<Item>([a], (m) => seen.push(m)).violate('текст');
    expect(seen).toEqual(['текст']);
  });

  it('undefined — объявлено всё, нарушений нет', () => {
    const set = new DeclaredSet<Item>(undefined);
    expect(set.has(a)).toBe(true);
    expect(() => set.assert(b, 'нет')).not.toThrow();
  });

  it('пустой список — не объявлено ничего', () => {
    const set = new DeclaredSet<Item>([]);
    expect(set.has(a)).toBe(false);
    expect(() => set.assert(a, 'пусто')).toThrow(new Error('пусто'));
  });

  it('другой объект с тем же именем — нарушение (сравнение по ссылке)', () => {
    const set = new DeclaredSet<Item>([a]);
    const twin: Item = { name: 'a' };
    expect(set.has(twin)).toBe(false);
    expect(() => set.assert(twin, 'двойник')).toThrow(new Error('двойник'));
  });

  it('строки сравниваются по значению (множество имён)', () => {
    const set = new DeclaredSet<string>(['todo.created']);
    expect(set.has('todo.created')).toBe(true);
    expect(set.has('todo.done')).toBe(false);
  });
});
