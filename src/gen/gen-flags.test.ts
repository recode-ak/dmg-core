import { expect, test } from 'bun:test';
import { GenFlags } from './gen-flags';

// Общий разбор флагов `gen` для своих видов и видов поставщиков; разбор
// своих видов целиком — в `cli.test.ts`.

test('--write и --dry-run: побеждает последний', () => {
  expect(GenFlags.parse(['--write', '--dry-run'], 'U').write).toBe(false);
  expect(GenFlags.parse(['--dry-run', '--write'], 'U').write).toBe(true);
});
