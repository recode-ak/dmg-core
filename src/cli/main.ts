#!/usr/bin/env bun
/**
 * CLI пакета: каркас проекта, доставка скилов, ролей и вставки в инструкции
 * агентов, генератор модулей, чтение лога операций, документ графа
 * приложения, проверка дерева документации. Команды — `USAGE` ниже.
 */
import { join } from 'node:path';
import { DmgCoreCli } from './dmg-core-cli';
import { DocsCommand } from './docs-command';
import { GraphCommand } from './graph-command';
import { OplogCommand } from './oplog-command';
import { PackageSource } from './package-source';

const USAGE = [
  'Использование: dmg-core init | sync [--check] | gen <вид> <модуль>[.<агрегат>] [<имя>] [--write] [--dry-run] [--adopt]',
  '               dmg-core init --profile single|monorepo [--name <имя>] [--dry-run]',
  '               dmg-core oplog <dir> [--request <id>] [--aggregate <uuid>] [--subject <id>] [--actor <id>] [--module <m>] [--op <o>] [--failed] [--since <d>] [--until <d>] [--json]',
  '               dmg-core graph <файл> [--out <путь>]',
  '               dmg-core docs --check',
].join('\n');

const [command, ...flags] = process.argv.slice(2);

// oplog — до загрузки пакета: читает только каталог лога.
if (command === 'oplog') {
  const done = await new OplogCommand().run(flags);
  const print = done.ok ? console.log : console.error;
  for (const message of done.messages) print(message);
  if (done.usage) console.error(USAGE);
  process.exit(done.ok ? 0 : 2);
}

// graph и docs — тоже без пакета проекта: graph читает файл приложения и
// `package.json` корня, docs — дерево документации от входов. Ошибка ввода —
// код 2 и справка, отказ по состоянию проекта — код 1.
const project =
  command === 'graph'
    ? new GraphCommand(process.cwd())
    : command === 'docs'
      ? new DocsCommand(process.cwd())
      : undefined;
if (project) {
  const done = await project.run(flags);
  const print = done.ok ? console.log : console.error;
  for (const message of done.messages) print(message);
  if (done.usage) console.error(USAGE);
  process.exit(done.ok ? 0 : done.usage ? 2 : 1);
}

const cli = new DmgCoreCli(
  await PackageSource.load(join(import.meta.dir, '../..')),
);
const root = process.cwd();

// gen и init: план и список файлов — в stdout, ошибка ввода или коллизия —
// в stderr, код 1. Пути gen — от корня проекта («.»); прежний init без
// аргументов при успехе ничего не печатает.
const planned =
  command === 'gen'
    ? await cli.gen('.', flags)
    : command === 'init'
      ? await cli.init(root, flags)
      : undefined;
if (planned) {
  const print = planned.ok ? console.log : console.error;
  for (const message of planned.messages) print(message);
  process.exit(planned.ok ? 0 : 1);
}

const check = flags.includes('--check');

const result =
  command === 'sync'
    ? check
      ? await cli.check(root)
      : await cli.sync(root)
    : undefined;

if (!result) {
  console.error(USAGE);
  process.exit(2);
}
for (const message of result.messages) console.error(message);
if (!result.ok) {
  if (check) console.error('Обнови копии: dmg-core sync');
  process.exit(1);
}
