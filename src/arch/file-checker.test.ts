import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ModuleDef } from '../domain/contracts/module-def';
import { DefIndex } from '../graph/def-index';
import { AlphaModuleDef, BetaModuleDef } from './arch.fixture';
import { FileChecker, type ModuleLayout } from './file-checker';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'arch-files-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const layout = (m: string): ModuleLayout => ({
  domain: join(root, 'domain', m),
  backend: join(root, 'app', m),
});

function write(path: string, text = 'export {};\n'): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/** Раскладка, при которой проверки по файлам проходят. */
function cleanTree(): void {
  for (const side of ['domain', 'app']) {
    write(`${side}/alpha/alpha.module.ts`);
    write(`${side}/alpha/note/er/add-note.er.ts`);
    write(`${side}/alpha/note/job/purge-notes.job.ts`);
    write(`${side}/beta/beta.module.ts`);
    write(`${side}/beta/item/uc/create-item.uc.ts`);
    write(`${side}/beta/item/uc/get-item.uc.ts`);
  }
}

const report = (): string[] =>
  new FileChecker(DefIndex.from([AlphaModuleDef]), layout)
    .check()
    .map((v) => v.format());

describe('FileChecker.todos — тексты Policy (вне графа Def)', () => {
  const todos = (): string[] =>
    new FileChecker(DefIndex.from([AlphaModuleDef]), layout)
      .todos()
      .map((v) => v.format());

  it('label/description Policy и label/denyMessage правил с TODO', () => {
    write(
      'domain/alpha/note/note.policy.ts',
      [
        'export const NotePolicy = PolicyDef.define({',
        "  name: 'note',",
        "  label: 'TODO: права на агрегат',",
        "  description: 'todo кто может',",
        '  rules: {',
        '    canView: Rule.of({',
        "      name: 'canView',",
        "      label: 'Кто смотрит',",
        "      denyMessage: 'Todo: почему отказано',",
        '    }),',
        '  },',
        '});',
      ].join('\n'),
    );
    expect(todos()).toEqual([
      'MAN-01: политика alpha/note/note.policy.ts:3: label не заполнен — «TODO: права на агрегат»',
      'MAN-01: политика alpha/note/note.policy.ts:4: description не заполнен — «todo кто может»',
      'MAN-01: политика alpha/note/note.policy.ts:9: denyMessage не заполнен — «Todo: почему отказано»',
    ]);
  });

  it('заполненная Policy, TODO не словом и тесты — без предупреждений', () => {
    write(
      'domain/alpha/note/note.policy.ts',
      "  label: 'Права (TODO позже)',\n  description: 'Todoist',\n",
    );
    write('domain/alpha/note/note.policy.test.ts', "  label: 'TODO',\n");
    expect(todos()).toEqual([]);
  });
});

describe('FileChecker', () => {
  // Импорты между модулями — не дело `FileChecker`: их проверяет `LayerChecker`.
  it('чистая раскладка — без нарушений', () => {
    cleanTree();
    write('domain/alpha/note/er/add-note.er.test.ts');
    expect(report()).toEqual([]);
  });

  describe('MAN-10 — пары путей', () => {
    it('реализация без контракта и контракт без реализации', () => {
      cleanTree();
      rmSync(join(root, 'app/beta/item/uc/create-item.uc.ts'));
      write('app/alpha/note/uc/extra.uc.ts');
      expect(report()).toEqual([
        'MAN-10: alpha/note/uc/extra.uc.ts есть в прикладном слое, нет в домене',
        'MAN-10: beta/item/uc/create-item.uc.ts есть в домене, нет в прикладном слое',
      ]);
    });

    it('ER не в папке основного агрегата', () => {
      cleanTree();
      for (const side of ['domain', 'app']) {
        rmSync(join(root, `${side}/alpha/note/er/add-note.er.ts`));
        write(`${side}/alpha/other/er/add-note.er.ts`);
      }
      expect(report()).toEqual([
        'MAN-10: ER alpha.addNote: ожидается файл note/er/add-note.er.ts',
        'MAN-06: alpha/other/er/add-note.er.ts — нет такой операции в модуле (Def вне модуля)',
      ]);
    });
  });

  describe('ARC-06 — прикладные пакеты', () => {
    it('у модуля нет прикладного пакета', () => {
      cleanTree();
      rmSync(join(root, 'app/beta'), { recursive: true });
      expect(report()).toEqual([
        `ARC-06: модуль beta: нет ${join(root, 'app/beta/beta.module.ts')}`,
        'MAN-10: beta/item/uc/create-item.uc.ts есть в домене, нет в прикладном слое',
        'MAN-10: beta/item/uc/get-item.uc.ts есть в домене, нет в прикладном слое',
      ]);
    });

    it('внешний модуль: только контракт в домене, прикладного пакета нет (D-37, D-42)', () => {
      cleanTree();
      rmSync(join(root, 'app/beta'), { recursive: true });
      const beta = ModuleDef.define({ ...BetaModuleDef, external: true });
      const alpha = ModuleDef.define({ ...AlphaModuleDef, dependsOn: [beta] });
      expect(
        new FileChecker(DefIndex.from([alpha]), layout)
          .check()
          .map((v) => v.format()),
      ).toEqual([]);
    });
  });
});
