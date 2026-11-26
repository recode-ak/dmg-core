import { describe, expect, test } from 'bun:test';
import type { DocsSection } from '../../gen/project-config.types';
import { DocKinds } from './doc-kinds';
import { DocsSettings } from './docs-settings';
import { MarkdownDoc } from './markdown-doc';

const REGISTRY = '# Реестр\n\n**Серия:** `D-<n>`\n';

function kindOf(path: string, text = '# Т\n', section?: DocsSection) {
  return new DocKinds(DocsSettings.of(section)).of(new MarkdownDoc(path, text));
}

describe('вид по признакам', () => {
  test('вход по умолчанию — llms.txt', () => {
    expect(kindOf('llms.txt')).toBe('entry');
  });

  test('свой вход заменяет умолчание: llms.txt становится листом', () => {
    const section = { entries: ['docs/start.md'] };
    expect(kindOf('docs/start.md', '# Т\n', section)).toBe('entry');
    expect(kindOf('llms.txt', '# Т\n', section)).toBe('leaf');
  });

  test('реестр — строка «Серия» или «Архив» в шапке', () => {
    expect(kindOf('docs/decisions.md', REGISTRY)).toBe('registry');
    expect(kindOf('docs/archive.md', '# А\n\n**Архив:** `D-01…D-10`\n')).toBe(
      'registry',
    );
  });

  test('оглавление — index.md в любом каталоге', () => {
    expect(kindOf('index.md')).toBe('index');
    expect(kindOf('docs/index.md')).toBe('index');
    expect(kindOf('docs/guides/index.md')).toBe('index');
  });

  test('оглавление — SKILL.md скила, в том числе под .claude/', () => {
    expect(kindOf('skills/x/SKILL.md')).toBe('index');
    expect(kindOf('.claude/skills/x/SKILL.md')).toBe('index');
  });

  test('SKILL.md глубже каталога скила и похожие имена — лист', () => {
    expect(kindOf('skills/x/y/SKILL.md')).toBe('leaf');
    expect(kindOf('skills/SKILL.md')).toBe('leaf');
    expect(kindOf('docs/myindex.md')).toBe('leaf');
    expect(kindOf('docs/index.md.bak')).toBe('leaf');
  });

  test('всё прочее — лист', () => {
    expect(kindOf('docs/guide.md')).toBe('leaf');
    expect(kindOf('README.md')).toBe('leaf');
  });
});

describe('порядок признаков: generated, entry, registry, index, leaf', () => {
  test('генерируемое сильнее входа', () => {
    const section = {
      entries: ['docs/state/x.md'],
      generated: ['docs/state/'],
    };
    expect(kindOf('docs/state/x.md', '# Т\n', section)).toBe('generated');
  });

  test('генерируемое сильнее реестра и оглавления', () => {
    const section = { generated: ['docs/state/'] };
    expect(kindOf('docs/state/index.md', '# Т\n', section)).toBe('generated');
    expect(kindOf('docs/state/r.md', REGISTRY, section)).toBe('generated');
  });

  test('вход сильнее реестра', () => {
    expect(kindOf('llms.txt', REGISTRY)).toBe('entry');
  });

  test('вход сильнее оглавления: index.md в entries — вход', () => {
    expect(kindOf('index.md', '# Т\n', { entries: ['index.md'] })).toBe(
      'entry',
    );
  });

  test('реестр сильнее оглавления: index.md с «Серия» — реестр', () => {
    expect(kindOf('docs/index.md', REGISTRY)).toBe('registry');
  });
});
