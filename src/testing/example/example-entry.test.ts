import { describe, expect, it } from 'bun:test';
import manifest from '../../../package.json' with { type: 'json' };

describe('вход dmg-core/testing/example', () => {
  it('exports объявляет именованный вход на index.ts учебного модуля', () => {
    const exports: Record<string, string> = manifest.exports;
    expect(exports['./testing/example']).toBe('./src/testing/example/index.ts');
  });

  it('вход отдаёт приложение, его Def и контракты модуля todo', async () => {
    const entry = await import('dmg-core/testing/example');
    expect(Object.keys(entry)).toEqual(
      expect.arrayContaining([
        'ExampleApp',
        'ExampleAppDef',
        'CreateTaskUcDef',
        'CompleteTaskUcDef',
        'CompleteTasksUcDef',
        'ListTasksUcDef',
        'ListAssignedTasksUcDef',
        'AssignTaskUcDef',
        'GetTaskAssigneeUcDef',
        'TaskEvents',
        'TaskErrors',
      ]),
    );
  });
});
