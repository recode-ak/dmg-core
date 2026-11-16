import { describe, expect, test } from 'bun:test';
import {
  type Cause,
  type RequestMeta,
  Trace,
  type TraceChannel,
  type TraceJson,
} from './index';

describe('корень dmg-core — след (D-102)', () => {
  test('след строится и проходит границу JSON без dmg-core/app', () => {
    const channel: TraceChannel = { name: 'web' };
    const meta: RequestMeta & { requestId: string } = {
      requestId: 'r-1',
      channel,
    };
    const wire: TraceJson = Trace.fromRequest(meta).toJSON();
    const cause: Cause = Trace.fromJSON(wire).cause;
    expect(cause).toEqual({ kind: 'request', requestId: 'r-1' });
  });
});
