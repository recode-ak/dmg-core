/**
 * Вход поставщика `example-provider`: скилы, роли и вид `gen`. Фикстура —
 * образец пакета, расширяющего `dmg-core`. Свой `package.json` отрезает
 * `imports` пакета, поэтому `dmg-core` отсюда импортируется относительными
 * путями.
 * @see src/cli/dmg-core-cli.providers.test.ts
 * @see src/gen/main.test.ts
 */
import { join } from 'node:path';
import {
  GenError,
  type GenPlan,
  type GenProvider,
  type GenProviderKind,
} from '../../gen/index';

const NAME = 'example-unit';

/** Единица слоя `example-unit`: `index.ts` и, если у слоя есть пакет, его `package.json` */
const plan: GenProviderKind['plan'] = (args, { layout }): GenPlan => {
  const [module, ...extra] = args;
  if (module === undefined || extra.length > 0) {
    throw new GenError(`Для «${NAME}» нужен один аргумент — <модуль>`);
  }
  const files: GenPlan['files'] = [
    {
      path: join(layout.layerDir(NAME, module), 'index.ts'),
      content: `export const unit = '${module}';\n`,
    },
  ];
  const pkg = layout.layerPackage(NAME, module);
  if (pkg === undefined) return { files, edits: [] };
  files.push({
    path: join(pkg.dir, 'package.json'),
    content: `${JSON.stringify(
      {
        name: pkg.name,
        private: true,
        type: 'module',
        exports: { '.': './src/index.ts' },
      },
      null,
      2,
    )}\n`,
  });
  return {
    files,
    edits: [],
    dependencies: [
      {
        path: join(layout.root, 'package.json'),
        name: pkg.name,
        version: 'workspace:*',
      },
    ],
    notes: ['Затем bun install — чтобы пакет единицы появился в node_modules.'],
  };
};

export const gen: GenProvider = {
  kinds: [{ name: NAME, usage: '<модуль>', plan }],
};
