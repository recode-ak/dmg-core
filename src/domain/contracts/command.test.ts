// Команда UC (D-49): простые данные `{ uc, input, meta? }` из Def,
// фантомный `D` несёт типы входа, выхода и ошибок к клиенту.
import { describe, expect, expectTypeOf, it } from 'bun:test';
import type { CommandMeta, DefOfCommand } from './command';
import { CompleteTaskUcDef, ListTasksUcDef } from './contracts.fixture';
import { type AnyUseCaseDef, UseCaseDef } from './use-case-def';

const taskId = '0190a6c4-1b2c-7d3e-8f40-123456789abc';

describe('UseCaseDef.command', () => {
  it('собирает команду: uc — имя Def, input как есть, без meta', () => {
    const command = CompleteTaskUcDef.command({ taskId });

    expect(command).toEqual({ uc: 'completeTask', input: { taskId } });
    expect('meta' in command).toBe(false);
  });

  it('meta передаётся в команду', () => {
    const meta: CommandMeta = { requestId: 'r-1' };

    const command = ListTasksUcDef.command({}, meta);

    expect(command).toEqual({ uc: 'listTasks', input: {}, meta });
  });

  it('meta — только requestId: версии в meta нет (D-57)', () => {
    expectTypeOf<keyof CommandMeta>().toEqualTypeOf<'requestId'>();
  });

  it('команда — простые данные: JSON туда и обратно без потерь', () => {
    const command = CompleteTaskUcDef.command({ taskId }, { requestId: 'r-2' });

    expect(JSON.parse(JSON.stringify(command))).toEqual(command);
    expect(Object.getPrototypeOf(command)).toBe(Object.prototype);
  });
});

describe('UseCaseDef.commandOf — команда в обобщённом коде', () => {
  it('по Def, стёртому до AnyUseCaseDef, — та же команда, что command', () => {
    const def: AnyUseCaseDef = CompleteTaskUcDef;
    const meta: CommandMeta = { requestId: 'r-3' };

    expect(UseCaseDef.commandOf(def, { taskId })).toEqual(
      CompleteTaskUcDef.command({ taskId }),
    );
    expect(UseCaseDef.commandOf(def, { taskId }, meta)).toEqual(
      CompleteTaskUcDef.command({ taskId }, meta),
    );
  });
});

describe('типы Command<D>', () => {
  type Complete = typeof CompleteTaskUcDef;

  it('команда из Def несёт этот Def фантомно', () => {
    const command = CompleteTaskUcDef.command({ taskId });

    expectTypeOf<DefOfCommand<typeof command>>().toEqualTypeOf<Complete>();
  });

  it('вход проверяет компилятор', () => {
    // @ts-expect-error — нет обязательного taskId
    CompleteTaskUcDef.command({});
  });
});
