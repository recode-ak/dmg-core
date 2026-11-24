// Тестовые хелперы фреймворка DMG: dmg-core/testing.

export {
  MemoryTasks,
  OWNER,
  T0,
  TASK,
  TASK_2,
  taskRow,
} from '../app/app.fixture';
export { TEST_NOW, testAppContext } from './app-context';
export { AwaitingBus } from './awaiting-bus';
export { ExampleArch } from './example/example.arch';
export { ExampleGraph } from './example/example.graph';
export { ExampleAppDef } from './example/platform/domain/example.app';
export { expectErr, expectOk } from './expect-result';
export { MemoryBus, RecordingBus } from './memory-bus';
export { type LogRecord, MemoryLogger } from './memory-logger';
export { MemoryOperationLog } from './memory-operation-log';
export {
  type MemoryAr,
  MemoryRepo,
  type MemorySnapshot,
} from './memory-repo';
export {
  expectIdempotentReaction,
  type ReactionIdempotencySpec,
} from './reaction-idempotency';
export { type StubCall, StubFacade } from './stub-facade';
export { TempDir, useTempDir } from './temp-dir';
export { TEST_TRACE, testTrace } from './test-trace';
export { testUuid } from './test-uuid';
