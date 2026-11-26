import { describe, expect, test } from 'bun:test';
import { MarkdownDoc } from './markdown-doc';

const doc = (text: string, path = 'docs/a.md') => new MarkdownDoc(path, text);

describe('lineCount', () => {
  test('считаются строки текста, последний перевод строки строку не добавляет', () => {
    expect(doc('a\nb\n').lineCount).toBe(2);
    expect(doc('a\n\n').lineCount).toBe(2);
    expect(doc('').lineCount).toBe(0);
  });

  test('front-matter в строки не входит', () => {
    expect(
      doc('---\ncovers: src/**\nverified: abc\n---\n# Тема\nтекст\n').lineCount,
    ).toBe(2);
  });

  test('блок кода считается', () => {
    expect(doc('а\n```ts\nconst x = 1;\n```\nб\n').lineCount).toBe(5);
  });

  test('«---» не в начале файла — не front-matter', () => {
    expect(doc('# Тема\n---\nтекст\n---\n').lineCount).toBe(4);
  });
});

describe('links', () => {
  test('ссылка: href, цель, якорь и номер строки файла', () => {
    const links = doc('# Т\n\nсм. [лист](./b.md#часть) тут\n').links();
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      href: './b.md#часть',
      target: './b.md',
      anchor: 'часть',
      line: 3,
    });
  });

  test('без якоря — anchor не задан; «#якорь» — пустая цель', () => {
    const [plain, own] = doc('[a](./b.md)\n[c](#раздел)\n').links();
    expect(plain?.target).toBe('./b.md');
    expect(plain?.anchor).toBeUndefined();
    expect(own).toMatchObject({ target: '', anchor: 'раздел', line: 2 });
  });

  test('номер строки считается по файлу, front-matter включён', () => {
    const text = '---\ncovers: x\n---\n\n[a](./b.md)\n';
    expect(doc(text).links()[0]?.line).toBe(5);
  });

  test('несколько ссылок: в порядке текста, в одной строке тоже', () => {
    const links = doc('[a](a.md) и [b](b.md)\n[c](c.md)\n').links();
    expect(links.map((l) => [l.target, l.line])).toEqual([
      ['a.md', 1],
      ['b.md', 1],
      ['c.md', 2],
    ]);
  });

  test('ссылка в заголовке и в пункте списка берётся', () => {
    const links = doc('## [Тема](t.md)\n- [Лист](l.md) — когда\n').links();
    expect(links.map((l) => l.target)).toEqual(['t.md', 'l.md']);
  });

  test('ссылка в блоке кода ``` и ~~~ не берётся', () => {
    const text = [
      '[до](a.md)',
      '```md',
      '[в блоке](b.md)',
      '```',
      '~~~',
      '[в тильдах](c.md)',
      '~~~',
      '[после](d.md)',
      '',
    ].join('\n');
    expect(
      doc(text)
        .links()
        .map((l) => [l.target, l.line]),
    ).toEqual([
      ['a.md', 1],
      ['d.md', 8],
    ]);
  });

  test('ссылка во вставке кода в бэктиках не берётся', () => {
    const text = 'пример `[x](нет.md)` и [живая](a.md)\n';
    expect(
      doc(text)
        .links()
        .map((l) => l.target),
    ).toEqual(['a.md']);
  });

  test('ссылка с кодом в тексте — ссылка: код внутри [] цель не прячет', () => {
    const links = doc('см. [`x.md`](./x.md#раздел)\n').links();
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ target: './x.md', anchor: 'раздел' });
  });

  test('вставка кода и ссылка с кодом рядом: берётся только ссылка', () => {
    const text = '`[a](a.md)` и [`b`](b.md)\n';
    expect(
      doc(text)
        .links()
        .map((l) => l.target),
    ).toEqual(['b.md']);
  });
});

describe('anchors', () => {
  test('slug по правилам GitHub: регистр, знаки препинания, пробелы', () => {
    const anchors = doc(
      '# Привет, Мир!\n## Вид 6: DOC-05\n### Секция `docs`\n',
    ).anchors();
    expect([...anchors]).toEqual(['привет-мир', 'вид-6-doc-05', 'секция-docs']);
  });

  test('повтор заголовка получает -1, -2', () => {
    const anchors = doc('## Тема\n## Тема\n## Тема\n').anchors();
    expect([...anchors]).toEqual(['тема', 'тема-1', 'тема-2']);
  });

  test('ссылка в заголовке — в slug её текст', () => {
    const anchors = doc('## [Док](x.md) тут\n').anchors();
    expect(anchors.has('док-тут')).toBe(true);
    expect(anchors.size).toBe(1);
  });

  test('заголовок в блоке кода якоря не даёт', () => {
    const anchors = doc(
      '## Живой\n```md\n## Мёртвый\n```\n~~~\n## Тоже\n~~~\n',
    ).anchors();
    expect([...anchors]).toEqual(['живой']);
  });

  test('нет заголовков — пустое множество', () => {
    expect(doc('просто текст\n').anchors().size).toBe(0);
  });
});

describe('isRegistry', () => {
  test('«Серия» в шапке — реестр', () => {
    expect(
      doc('# Решения\n\n**Серия:** `D-<n>`\n\n## Группа\n').isRegistry(),
    ).toBe(true);
  });

  test('«Архив» в шапке — реестр', () => {
    expect(doc('# История\n\n**Архив:** `D-01…D-101`\n').isRegistry()).toBe(
      true,
    );
  });

  test('«Серия» после первого `## ` — не шапка', () => {
    expect(doc('# Т\n\n## Группа\n\n**Серия:** `D-<n>`\n').isRegistry()).toBe(
      false,
    );
  });

  test('строка в бэктиках внутри таблицы — не реестр', () => {
    const text =
      '# Правила\n\n| Строка | Что |\n|---|---|\n| `**Серия:**` | объявляет |\n';
    expect(doc(text).isRegistry()).toBe(false);
  });

  test('строка начинается не с «Серия» — не реестр', () => {
    expect(doc('# Т\n\nшапка: **Серия:** `D-<n>`\n').isRegistry()).toBe(false);
  });

  test('строка в блоке кода — не реестр', () => {
    expect(doc('# Т\n\n```md\n**Серия:** `D-<n>`\n```\n').isRegistry()).toBe(
      false,
    );
  });

  test('`## ` в блоке кода шапку не обрывает', () => {
    const text = '# Т\n\n```md\n## пример\n```\n\n**Серия:** `D-<n>`\n';
    expect(doc(text).isRegistry()).toBe(true);
  });

  test('без строки «Серия» и «Архив» — не реестр', () => {
    expect(doc('# Т\n\nтекст\n').isRegistry()).toBe(false);
  });

  test('«Серия» после первого `###` — не шапка: шапка кончается и на `###`', () => {
    const text = '# Т\n\n### D-1. Запись\n\n**Серия:** `D-<n>`\n';
    expect(doc(text).isRegistry()).toBe(false);
  });

  test('`###` в блоке кода шапку не обрывает', () => {
    const text = '# Т\n\n```md\n### D-1. пример\n```\n\n**Серия:** `D-<n>`\n';
    expect(doc(text).isRegistry()).toBe(true);
  });
});

describe('listItems', () => {
  test('пункт: ссылка, « — », подпись; номер строки файла', () => {
    const items = doc('# Т\n\n- [Лист](./a.md) — когда читать\n').listItems();
    expect(items).toHaveLength(1);
    expect(items[0]?.line).toBe(3);
    expect(items[0]?.links.map((l) => l.target)).toEqual(['./a.md']);
    expect(items[0]?.caption).toBe('когда читать');
  });

  test('маркеры -, *, +, N. и отступ — пункты', () => {
    const text = [
      '- [a](a.md) — раз',
      '* [b](b.md) — два',
      '+ [c](c.md) — три',
      '1. [d](d.md) — четыре',
      '   - [e](e.md) — пять',
      '',
    ].join('\n');
    expect(
      doc(text)
        .listItems()
        .map((i) => i.caption),
    ).toEqual(['раз', 'два', 'три', 'четыре', 'пять']);
  });

  test('ссылка с кодом в тексте — начало пункта', () => {
    const items = doc('- [`x`](x.md) — когда читать\n').listItems();
    expect(items[0]?.caption).toBe('когда читать');
  });

  test('нет разделителя — подписи нет', () => {
    const items = doc(
      '- [Лист](a.md)\n- [Лист](b.md) подпись без тире\n',
    ).listItems();
    expect(items.map((i) => i.caption)).toEqual([undefined, undefined]);
    expect(items).toHaveLength(2);
  });

  test('перед подписью вторая ссылка — подписи нет', () => {
    const items = doc('- [A](a.md) — [B](b.md) когда\n').listItems();
    expect(items).toHaveLength(1);
    expect(items[0]?.caption).toBeUndefined();
  });

  test('в .md разделитель « — », двоеточие подписью не считается', () => {
    const items = doc('- [A](a.md): когда\n', 'docs/index.md').listItems();
    expect(items[0]?.caption).toBeUndefined();
  });

  test('во входе .txt разделитель «: », тире подписью не считается', () => {
    const colon = doc('- [A](a.md): когда\n', 'llms.txt').listItems();
    expect(colon[0]?.caption).toBe('когда');
    const dash = doc('- [A](a.md) — когда\n', 'llms.txt').listItems();
    expect(dash[0]?.caption).toBeUndefined();
  });

  test('не пункты: список не со ссылки, таблица, проза, блок кода', () => {
    const text = [
      '- текст [A](a.md) — когда',
      '| [B](b.md) | — когда |',
      '[C](c.md) — когда',
      '```md',
      '- [D](d.md) — когда',
      '```',
      '',
    ].join('\n');
    expect(doc(text).listItems()).toEqual([]);
  });
});
