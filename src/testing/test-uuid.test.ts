import { describe, expect, test } from 'bun:test';
import * as v from 'valibot';
import { F } from '#core/kernel/fields/fields';
import { testUuid } from '#core/testing/index';

describe('testUuid', () => {
  test('n — последние 12 hex-знаков, префикс по умолчанию 00000000', () => {
    expect(testUuid(1)).toBe('00000000-0000-4000-8000-000000000001');
    expect(testUuid(255)).toBe('00000000-0000-4000-8000-0000000000ff');
  });

  test('граничные n: 0 и 2^48 − 1', () => {
    expect(testUuid(0)).toBe('00000000-0000-4000-8000-000000000000');
    expect(testUuid(2 ** 48 - 1)).toBe('00000000-0000-4000-8000-ffffffffffff');
  });

  test('свой префикс — первые 8 знаков', () => {
    expect(testUuid(7, 'aaaaaaaa')).toBe(
      'aaaaaaaa-0000-4000-8000-000000000007',
    );
  });

  test('результат проходит F.uuid', () => {
    expect(v.safeParse(F.uuid('теста'), testUuid(42)).success).toBe(true);
  });

  test.each([-1, 1.5, Number.NaN, 2 ** 48])(
    'n = %p — не целое ≥ 0 или не помещается в 12 hex — исключение',
    (n) => {
      expect(() => testUuid(n)).toThrow('testUuid');
    },
  );
});
