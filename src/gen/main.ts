/** Диспетчер `dmg-core gen`: разбор → проверка → план → применение → отчёт. */
import { applyPlan } from './apply';
import { type GenArgs, GenError, type GenKind, parseArgs } from './cli';
import { GenFlags } from './gen-flags';
import { GenKinds } from './gen-kinds';
import type { OwnedKind } from './gen-kinds.types';
import { planDomainAggregate } from './kinds/aggregate';
import { planAppAggregate } from './kinds/app-aggregate';
import { planAppModule } from './kinds/app-module';
import { planDomainModule } from './kinds/module';
import { planModulePackage } from './kinds/module-package';
import { planOperation } from './kinds/operation';
import { planDomainService } from './kinds/service';
import type { GenLayout } from './layout';
import type { GenPlan } from './plan';
import { validate } from './validate';

/** Планировщик по виду артефакта CLI: таблица вместо `switch`. */
const PLANNERS: Record<GenKind, (args: GenArgs) => GenPlan> = {
  module: (args) =>
    merge(planDomainModule(args), planAppModule(args), planModulePackage(args)),
  aggregate: (args) => merge(planDomainAggregate(args), planAppAggregate(args)),
  uc: planOperation,
  er: planOperation,
  job: planOperation,
  dcs: planDomainService,
  dqs: planDomainService,
};

const merge = (...plans: GenPlan[]): GenPlan => ({
  files: plans.flatMap((p) => p.files),
  edits: plans.flatMap((p) => p.edits),
  dependencies: plans.flatMap((p) => p.dependencies ?? []),
  notes: plans.flatMap((p) => p.notes ?? []),
});

/**
 * Возвращает код выхода процесса; вывод — через `print`. `dependencies` —
 * диапазоны зависимостей пакета модуля (нужны при `gen.package`); `kinds` —
 * каталог видов с видами поставщиков. Флаги разбираются до поиска вида.
 */
export function runGen(
  argv: readonly string[],
  layout: GenLayout,
  print: (line: string) => void,
  dependencies?: Readonly<Record<string, string>>,
  kinds = new GenKinds(),
): number {
  try {
    const flags = GenFlags.parse(argv, kinds.usage());
    const [name] = flags.positional;
    if (name === undefined) throw new GenError(kinds.usage());
    const found = kinds.find(name);
    if (found === undefined) {
      throw new GenError(`Неизвестный вид «${name}»\n${kinds.usage()}`);
    }
    const plan =
      typeof found === 'string'
        ? planOwn(argv, layout, print, dependencies)
        : planProvided(name, found, flags.positional.slice(1), layout, print);
    report(plan, flags, print);
    return 0;
  } catch (error) {
    if (GenError.is(error)) {
      print(`Ошибка: ${error.message}`);
      return 1;
    }
    throw error;
  }
}

/** Свой вид: разбор, проверка домена, план; первая строка — раскладка */
function planOwn(
  argv: readonly string[],
  layout: GenLayout,
  print: (line: string) => void,
  dependencies?: Readonly<Record<string, string>>,
): GenPlan {
  const args = { ...parseArgs(argv, layout), dependencies };
  validate(args);
  const plan = PLANNERS[args.kind](args);
  print(layout.describe());
  return plan;
}

/**
 * Вид поставщика: план по позиционным аргументам после имени. Форма плана —
 * по признакам: вид из чужой копии пакета, `Promise` — не план.
 */
function planProvided(
  name: string,
  { owner, kind }: OwnedKind,
  args: readonly string[],
  layout: GenLayout,
  print: (line: string) => void,
): GenPlan {
  const plan: Partial<GenPlan> | undefined = kind.plan(args, { layout });
  if (!Array.isArray(plan?.files) || !Array.isArray(plan?.edits)) {
    throw new GenError(
      `вид «${name}» (${owner}) вернул не план — нужен { files, edits }`,
    );
  }
  print(`Вид «${name}» — ${owner}, ${layout.describeLayers()}`);
  return plan as GenPlan;
}

/** Применение плана и отчёт — общие для своих видов и видов поставщиков */
function report(
  plan: GenPlan,
  { write, adopt }: GenFlags,
  print: (line: string) => void,
): void {
  const result = applyPlan(plan, { write, adopt });
  const verb = write ? 'Создан' : 'Будет создан';
  for (const path of result.written) print(`${verb}: ${path}`);
  for (const file of result.skipped) {
    print(`Пропущен: ${file.path} (уже есть) — сверь вручную с шаблоном:`);
    for (const line of file.content.trimEnd().split('\n')) print(`  ${line}`);
  }
  for (const path of result.edited) {
    print(`${write ? 'Изменён' : 'Будет изменён'}: ${path}`);
  }
  for (const hint of result.hints) {
    const why = hint.reason === undefined ? '' : ` (${hint.reason})`;
    print(`Вставь вручную в ${hint.path} перед ${hint.marker}${why}:`);
    print(`  ${hint.line}`);
  }
  for (const dep of result.dependencyHints) {
    print(
      `Вставь вручную в ${dep.path}, dependencies: "${dep.name}": "${dep.version}"`,
    );
  }
  for (const note of plan.notes ?? []) print(note);
  if (!write) print('Это dry-run. Для записи добавь --write.');
}
