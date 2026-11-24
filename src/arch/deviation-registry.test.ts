import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeviationRegistry } from './deviation-registry';
import type { ArchDebt } from './deviation-registry.types';
import { Violation } from './violation';

// Сопоставление нарушений с записями реестра долга кода (D-111): корень
// путей Места — `/repo`, проект — `/repo/proj`, файлы проекта — `FILES`.
// Нарушение импорта несёт абсолютный путь файла (`Violation.file`); снимаются
// только ID из `debtIds` — доступы поставщика с `debt: true`.
const ROOT = '/repo';
const at = (path: string): string => `${ROOT}/${path}`;

const TASKS = 'proj/screen-code/tasks/tasks-screen.ts';
const LIST = 'proj/screen-code/list/list-screen.ts';
const FILES = [
  at(TASKS),
  at(LIST),
  at('proj/screen-code/card/public.ts'),
  at('proj/screen-code/card/card-view.ts'),
];
const DEBT_IDS: ReadonlySet<string> = new Set(['SCR-04']);

/** Реестр долга кода со строкой «Последний выданный ID» в шапке. */
const registry = (...entries: string[]): string =>
  [
    '# Долг кода',
    '**Последний выданный ID:** `DEBT-3`',
    '## 1. Отступления',
    ...entries,
  ].join('\n\n');

/** Запись `DEBT-1`: Место — glob'ы списком, поле Правило — как задано (`null` — без поля). */
const entry = (
  places: readonly string[],
  rule: string | null = '`SCR-04`',
  id = 'DEBT-1',
): string =>
  [
    `### ${id}: экран tasks показывает карточку мимо public.ts`,
    '- **Место:**',
    ...places.map((glob) => `  - \`${glob}\``),
    ...(rule === null ? [] : [`- **Правило:** ${rule}`]),
    "- **Признак:** `from '../card/card-view'`",
    '- **Корень:** `proj/screen-code/card/**`',
    '- **Триггер:** карточка получит вход для превью',
    '- **Причина:** превью карточки нужно до входа.',
  ].join('\n');

const deviations = (md: string): DeviationRegistry =>
  new DeviationRegistry({ md, idPrefix: 'DEBT', root: ROOT, files: FILES });

/** Нарушение `SCR-04` (чужой экран мимо входа) или другого ID в файле `file`. */
const past = (file: string, rule = 'SCR-04'): Violation =>
  new Violation(
    rule,
    `${file.slice('proj/'.length)} (screen-code) импортирует screen-code card мимо public.ts: ../card/card-view`,
    at(file),
  );

const lines = (violations: readonly Violation[]): string[] =>
  violations.map((v) => v.format());

describe('DeviationRegistry: сопоставление нарушений с записями (ARC-12)', () => {
  it('нарушение с ID записи в файле вне Места остаётся', () => {
    const registered = past(TASKS);
    const outside = past(LIST);
    const md = registry(entry(['proj/screen-code/tasks/**']));
    expect(
      lines(deviations(md).apply([registered, outside], DEBT_IDS)),
    ).toEqual([outside.format()]);
  });

  it('нарушение другого ID в файле Места остаётся', () => {
    const other = past(TASKS, 'SCR-03');
    const md = registry(entry(['proj/screen-code/tasks/**']));
    expect(lines(deviations(md).apply([other, past(TASKS)], DEBT_IDS))).toEqual(
      [other.format()],
    );
  });

  it('glob Места без снятого нарушения — ARC-12 «не нашло нарушения», другой glob записи снимает', () => {
    // `other-app/**` не находит файлов проекта — glob другого приложения, молчит.
    const md = registry(
      entry([
        'proj/screen-code/tasks/**',
        'proj/screen-code/card/**',
        'other-app/**',
      ]),
    );
    expect(lines(deviations(md).apply([past(TASKS)], DEBT_IDS))).toEqual([
      'ARC-12: DEBT-1: отступление SCR-04 не нашло нарушения (`proj/screen-code/card/**`) — сними glob или закрой запись',
    ]);
  });

  it('запись без поля Правило — не отступление: не снимает и не сверяется', () => {
    const registered = past(TASKS);
    const md = registry(
      entry(['proj/screen-code/tasks/**', 'proj/screen-code/card/**'], null),
    );
    expect(lines(deviations(md).apply([registered], DEBT_IDS))).toEqual([
      registered.format(),
    ]);
  });

  it('поле Правило без ID — ARC-12', () => {
    const registered = past(TASKS);
    const md = registry(
      entry(['proj/screen-code/tasks/**'], 'отступление от входа экрана'),
    );
    expect(lines(deviations(md).apply([registered], DEBT_IDS))).toEqual([
      registered.format(),
      'ARC-12: DEBT-1: поле Правило без ID',
    ]);
  });

  it('Место не находит файлов проекта — запись другого приложения: не сверяется', () => {
    // ARC-06 отступления не допускает, Правило DEBT-2 без ID: сверка дала бы ARC-12.
    const registered = past(TASKS);
    const md = registry(
      entry(['other-app/screen-code/**'], '`ARC-06`'),
      entry(['other-app/views/**'], 'без ID', 'DEBT-2'),
    );
    expect(lines(deviations(md).apply([registered], DEBT_IDS))).toEqual([
      registered.format(),
    ]);
  });
});

describe('DeviationRegistry: отказ конфигурации', () => {
  let base: string;
  let proj: string;

  beforeEach(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'arch-deviations-')));
    proj = join(base, 'proj');
    mkdirSync(proj);
    writeFileSync(join(proj, 'page.ts'), 'export {};\n');
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  const debt = (over: Partial<ArchDebt> = {}): ArchDebt => ({
    root: base,
    code: 'debt.md',
    idPrefix: 'DEBT',
    ...over,
  });

  /** Сообщение отказа `read`. */
  function refusal(input: ArchDebt, project = proj): string {
    try {
      DeviationRegistry.read(input, project);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    return 'не бросил';
  }

  it('реестра нет — отказ', () => {
    expect(refusal(debt({ code: 'docs/debt.md' }))).toBe(
      `ArchApp.debt — нет реестра: ${join(base, 'docs', 'debt.md')}`,
    );
  });

  it('idPrefix не DEBT и не <X>-DEBT — отказ', () => {
    writeFileSync(join(base, 'debt.md'), registry());
    expect(refusal(debt({ idPrefix: 'DEBT-UI' }))).toBe(
      'ArchApp.debt.idPrefix — DEBT или <X>-DEBT: DEBT-UI',
    );
    expect(refusal(debt({ idPrefix: 'C-DEBT' }))).toBe('не бросил');
    expect(refusal(debt())).toBe('не бросил');
  });

  it('ArchApp.project вне debt.root — отказ', () => {
    const repo = join(base, 'repo');
    mkdirSync(repo);
    writeFileSync(join(repo, 'debt.md'), registry());
    expect(refusal(debt({ root: repo }))).toBe(
      `ArchApp.debt.root — ArchApp.project вне корня: ${proj}`,
    );
  });
});
