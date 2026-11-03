/**
 * JSDoc в `src/` длиннее 6 строк без `@see` (CODE-04, D-59). `bun run
 * docs:jsdoc` в `check` только предупреждает: основная проверка — `reviewer`.
 *
 * Чистая функция над файлами в памяти; чтение диска — `readDocs`.
 */
import { join } from 'node:path';
import { type DocFile, readDocs } from './docs-check';

const MAX_LINES = 6;

/** Предупреждения `путь:строка` по каждому длинному JSDoc без `@see`; тесты пропускаются */
export function longJsdoc(sources: readonly DocFile[]): string[] {
  const warnings: string[] = [];
  for (const file of sources) {
    if (file.path.endsWith('.test.ts')) continue;
    const lines = file.text.split('\n');
    for (let start = 0; start < lines.length; start++) {
      if (!lines[start]?.trim().startsWith('/**')) continue;
      let end = start;
      while (end < lines.length && !lines[end]?.includes('*/')) end++;
      const size = end - start + 1;
      const block = lines.slice(start, end + 1).join('\n');
      if (size > MAX_LINES && !block.includes('@see')) {
        warnings.push(
          `${file.path}:${start + 1}: JSDoc ${size} строк без @see (CODE-04)`,
        );
      }
      start = end;
    }
  }
  return warnings;
}

/** `@see` после текста строки JSDoc: тег TS распознаёт только в начале строки */
export function inlineSee(sources: readonly DocFile[]): string[] {
  const warnings: string[] = [];
  for (const file of sources) {
    if (file.path.endsWith('.test.ts')) continue;
    let inDoc = false;
    file.text.split('\n').forEach((line, i) => {
      const text = line.trim();
      if (text.startsWith('/**')) inDoc = true;
      if (inDoc && /\S.*@see/.test(text.replace(/^(\/\*\*|\*)\s*/, ''))) {
        warnings.push(
          `${file.path}:${i + 1}: @see не в начале строки JSDoc (CODE-04)`,
        );
      }
      if (text.includes('*/')) inDoc = false;
    });
  }
  return warnings;
}

if (import.meta.main) {
  const { sources } = readDocs(join(import.meta.dir, '..'));
  for (const line of [...longJsdoc(sources), ...inlineSee(sources)]) {
    console.warn(`warn: ${line}`);
  }
}
