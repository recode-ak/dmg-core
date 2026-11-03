/**
 * `bun run docs:impact <пути>` — документы, чьи `covers:` совпали с путями
 * (D-59): какой документ обновить в срезе. Пути — от корня пакета или с
 * префиксом `…/dmg-core/`.
 */
import { join } from 'node:path';
import { impactOf, readCovers } from './covers-check';

const { docs } = readCovers(join(import.meta.dir, '..'));
for (const path of impactOf(docs, process.argv.slice(2))) console.log(path);
