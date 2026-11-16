// Стабильный вход dmg-core/testing/example (D-101): учебное приложение,
// его Def и публичные контракты модулей todo и users (D-45). Глубокие пути
// `dmg-core/testing/example/*` работают, но стабильными не считаются.

export { ExampleApp } from './app/example-app';
export type { ExampleAppEnv, ExampleAppPorts } from './app/example-app.types';
export { ExampleAppDef } from './example.app';
export type { ExampleUser } from './shared/app-user';
export * from './todo/contract';
export * from './users/contract';
