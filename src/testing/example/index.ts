// Стабильный вход dmg-core/testing/example (D-101): учебное приложение,
// его Def и публичные контракты модулей todo и users (D-45). Глубокие пути
// `dmg-core/testing/example/*` работают, но стабильными не считаются.

export { ExampleAppDef } from './platform/domain/example.app';
export * from './platform/domain/todo/contract';
export * from './platform/domain/users/contract';
export type { ExampleUser } from './platform/kernel/app-user';
export { ExampleApp } from './runners/assembly/example-app';
export type {
  ExampleAppEnv,
  ExampleAppPorts,
} from './runners/assembly/example-app.types';
