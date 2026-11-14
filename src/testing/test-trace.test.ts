import { describe, expect, test } from 'bun:test';
import { TEST_TRACE, testTrace } from '#core/testing/index';

describe('TEST_TRACE', () => {
  test('след запроса r-1: причина и цепочка — r-1', () => {
    expect(TEST_TRACE.cause).toEqual({ kind: 'request', requestId: 'r-1' });
    expect(TEST_TRACE.correlationId).toBe('r-1');
  });
});

describe('testTrace', () => {
  test('с requestId — след запроса с этим id', () => {
    const trace = testTrace('r-42');
    expect(trace.cause).toEqual({ kind: 'request', requestId: 'r-42' });
    expect(trace.correlationId).toBe('r-42');
  });

  test('без аргумента — свежий r-<счётчик> без признака generated', () => {
    const trace = testTrace();
    expect(trace.cause).toEqual({
      kind: 'request',
      requestId: expect.stringMatching(/^r-\d+$/),
    });
  });

  test('два вызова без аргумента — разные requestId, не совпадают с TEST_TRACE', () => {
    const ids = [testTrace(), testTrace()].map((t) => t.correlationId);
    expect(new Set([...ids, TEST_TRACE.correlationId]).size).toBe(3);
  });
});
