/** Верхняя граница `n`: последние 12 hex-знаков uuid. */
const LIMIT = 2 ** 48;
const PREFIX = /^[0-9a-f]{8}$/;

/**
 * Детерминированный uuid v4 для тестов: `<prefix>-0000-4000-8000-<n>`, `n` —
 * 12 hex-знаков. Неверный `n` или `prefix` — исключение (ошибка теста).
 */
export function testUuid(n: number, prefix = '00000000'): string {
  if (!Number.isInteger(n) || n < 0 || n >= LIMIT)
    throw new Error(`testUuid: n — целое от 0 до 2^48 − 1, получено ${n}`);
  if (!PREFIX.test(prefix))
    throw new Error(`testUuid: prefix — 8 hex-знаков, получено ${prefix}`);
  return `${prefix}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}
