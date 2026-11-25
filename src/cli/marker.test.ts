import { describe, expect, test } from 'bun:test';
import { Marker } from './marker';

const marker = new Marker('1.2.3');

describe('Marker', () => {
  test('ставит метку после frontmatter', () => {
    const text = '---\nname: x\n---\n\nТело.\n';
    expect(marker.mark(text)).toBe(
      `---\nname: x\n---\n\n${marker.comment}\n\nТело.\n`,
    );
  });

  test('без frontmatter — метка в начале', () => {
    expect(marker.mark('Текст.\n')).toBe(`${marker.comment}\n\nТекст.\n`);
  });

  test('метка несёт версию и узнаётся', () => {
    expect(Marker.versionOf(marker.mark('Текст.'))).toBe('1.2.3');
    expect(Marker.versionOf('Текст без метки.')).toBeUndefined();
  });

  test('strip убирает метку — круг mark → strip без потерь', () => {
    const text = '---\nname: x\n---\n\nТело.\n';
    expect(Marker.strip(marker.mark(text))).toBe(text);
    expect(Marker.strip(marker.mark('Текст.\n'))).toBe('Текст.\n');
  });

  test('метка dmg-core — строка прежняя целиком (совместимость)', () => {
    expect(new Marker('1.2.3').comment).toBe(
      '<!-- dmg-core@1.2.3: сгенерировано `dmg-core sync` — не править -->',
    );
    expect(new Marker('1.2.3').name).toBe('dmg-core');
  });

  test('метка другого пакета несёт его имя и версию', () => {
    const other = new Marker('0.7.0', 'dmg-ui');
    expect(other.comment).toContain('dmg-ui@0.7.0');
    const text = other.mark('Текст.\n');
    expect(Marker.of(text)).toMatchObject({ name: 'dmg-ui', version: '0.7.0' });
    expect(Marker.versionOf(text)).toBe('0.7.0');
  });

  test('scoped-имя пакета в метке узнаётся целиком', () => {
    const scoped = new Marker('1.0.0', '@acme/kit');
    expect(Marker.of(scoped.mark('Текст.\n'))).toMatchObject({
      name: '@acme/kit',
      version: '1.0.0',
    });
  });

  test('strip снимает метку чужого пакета; без метки of — undefined', () => {
    const text = '---\nname: x\n---\n\nТело.\n';
    expect(Marker.strip(new Marker('0.7.0', 'dmg-ui').mark(text))).toBe(text);
    expect(Marker.of(text)).toBeUndefined();
  });
});
