import { describe, expect, test } from 'bun:test';
import { Marker } from './marker';
import { Role } from './role';

const SRC = 'agents/roles/reviewer.md';
const marker = new Marker('1.2.3');

function source(frontmatter: string, body = 'Промпт роли.'): string {
  return `---\n${frontmatter}\n---\n\n${body}\n`;
}

const REVIEWER = source(
  [
    'name: reviewer',
    'description: Проверка по rules.md',
    'tools: [read, grep, find, bash]',
    'model:',
    '  claude: sonnet',
    '  pi: claude-sonnet-4-5',
  ].join('\n'),
);

describe('Role.parse', () => {
  test('разбирает frontmatter и тело', () => {
    const role = Role.parse(SRC, REVIEWER);
    expect(role.name).toBe('reviewer');
    expect(role.description).toBe('Проверка по rules.md');
    expect(role.tools).toEqual(['read', 'grep', 'find', 'bash']);
    expect(role.model).toEqual({ claude: 'sonnet', pi: 'claude-sonnet-4-5' });
    expect(role.body).toBe('Промпт роли.');
  });

  test('model необязателен', () => {
    const role = Role.parse(
      SRC,
      source('name: reviewer\ndescription: d\ntools: [read]'),
    );
    expect(role.model).toEqual({});
  });

  test.each([
    ['Текст без frontmatter', 'нет frontmatter'],
    [source('name: other\ndescription: d\ntools: [read]'), 'name «other»'],
    [source('name: reviewer\ntools: [read]'), 'нужен description'],
    [source('name: reviewer\ndescription: d'), 'нужен непустой список tools'],
    [
      source('name: reviewer\ndescription: d\ntools: [read, ls]'),
      'неизвестный инструмент «ls»',
    ],
    [
      source('name: reviewer\ndescription: d\ntools: [read]\nextra: 1'),
      'неизвестное поле «extra»',
    ],
    [
      source('name: reviewer\ndescription: d\ntools: [read]\nmodel:\n  vim: x'),
      'неизвестная среда модели «vim»',
    ],
  ])('нарушение формата — ошибка с путём: %#', (text, message) => {
    expect(() => Role.parse(SRC, text)).toThrow(`${SRC}: ${message}`);
  });
});

describe('Role.render', () => {
  const role = Role.parse(SRC, REVIEWER);

  test('neutral — исходный текст с меткой', () => {
    expect(role.render('neutral', marker)).toBe(marker.mark(REVIEWER));
  });

  test('claude — инструменты и модель Claude Code, общий блок в конце', () => {
    const text = role.render('claude', marker, 'Общий блок.');
    expect(text).toBe(
      [
        '---',
        'name: reviewer',
        'description: "Проверка по rules.md"',
        'tools: Read, Grep, Glob, Bash',
        'model: sonnet',
        '---',
        '',
        marker.comment,
        '',
        'Промпт роли.',
        '',
        'Общий блок.',
        '',
      ].join('\n'),
    );
  });

  test('pi — инструменты как есть, модель pi', () => {
    const text = role.render('pi', marker);
    expect(text).toContain('tools: read, grep, find, bash\n');
    expect(text).toContain('model: claude-sonnet-4-5\n');
  });

  test('без модели для среды поле model не пишется', () => {
    const plain = Role.parse(
      SRC,
      source('name: reviewer\ndescription: d\ntools: [read]'),
    );
    expect(plain.render('claude', marker)).not.toContain('model:');
  });
});

describe('Role.renderEnv', () => {
  const role = Role.parse(SRC, REVIEWER);
  const comment = '<!-- Сгенерировано сборщиком проекта — не править. -->';

  test('копия среды со своей меткой сборщика и общим блоком', () => {
    expect(role.renderEnv('claude', comment, 'Общий блок.')).toBe(
      role
        .render('claude', marker, 'Общий блок.')
        .replace(marker.comment, comment),
    );
  });

  test('description экранируется и разбирается обратно', () => {
    const tricky = Role.parse(
      SRC,
      source('name: reviewer\ndescription: \'a: "b" # c\'\ntools: [read]'),
    );
    const fm = Bun.YAML.parse(
      tricky.renderEnv('pi', comment).split('---')[1] ?? '',
    ) as { description: string };
    expect(fm.description).toBe('a: "b" # c');
  });
});

describe('Role.withKnowledge', () => {
  const role = Role.parse(SRC, REVIEWER);
  const BLOCK = [
    '## Знания проекта',
    '',
    'Пути — от корня проекта; прочитай до начала работы:',
    '',
    '- `docs/ux.md`',
  ].join('\n');
  const knowing = () => role.withKnowledge(BLOCK);

  test('тело — прежнее тело и блок через пустую строку', () => {
    expect(knowing().body).toBe(`Промпт роли.\n\n${BLOCK}`);
    expect(knowing().name).toBe('reviewer');
    expect(role.body).toBe('Промпт роли.');
  });

  test('neutral — блок в конце исходника, метка после frontmatter, parse даёт тело с блоком', () => {
    const copy = knowing().render('neutral', marker);
    expect(copy).toBe(marker.mark(`${REVIEWER.trimEnd()}\n\n${BLOCK}\n`));
    expect(Role.parse(SRC, Marker.strip(copy)).body).toBe(
      `Промпт роли.\n\n${BLOCK}`,
    );
  });

  test('claude — тело, блок, общий блок: точно', () => {
    expect(knowing().render('claude', marker, 'Общий блок.')).toBe(
      [
        '---',
        'name: reviewer',
        'description: "Проверка по rules.md"',
        'tools: Read, Grep, Glob, Bash',
        'model: sonnet',
        '---',
        '',
        marker.comment,
        '',
        'Промпт роли.',
        '',
        BLOCK,
        '',
        'Общий блок.',
        '',
      ].join('\n'),
    );
  });

  test('pi — блок в копии один раз', () => {
    const text = knowing().render('pi', marker, 'Общий блок.');
    expect(text.split('## Знания проекта')).toHaveLength(2);
    expect(text).toContain(`Промпт роли.\n\n${BLOCK}\n\nОбщий блок.\n`);
  });

  test('renderEnv — блок после тела, до общего, метка сборщика', () => {
    const comment = '<!-- Сгенерировано сборщиком проекта — не править. -->';
    expect(knowing().renderEnv('pi', comment, 'Общий блок.')).toBe(
      role
        .renderEnv('pi', comment, 'Общий блок.')
        .replace('Промпт роли.\n', `Промпт роли.\n\n${BLOCK}\n`),
    );
  });

  test('пустой блок — render как прежде, во всех форматах', () => {
    const same = role.withKnowledge('');
    for (const format of ['neutral', 'claude', 'pi'] as const) {
      expect(same.render(format, marker, 'Общий блок.')).toBe(
        role.render(format, marker, 'Общий блок.'),
      );
    }
  });
});
