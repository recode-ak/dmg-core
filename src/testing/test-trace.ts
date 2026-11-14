import { Trace } from '../kernel/trace/trace';

/** След запроса `r-1` — для тестов, где `requestId` не важен. */
export const TEST_TRACE = Trace.fromRequest({ requestId: 'r-1' });

let issued = 1;

/**
 * След запроса с заданным `requestId`, без него — свежий `r-<n>` (n > 1):
 * отсев повторов (D-56) считает одинаковый `requestId` повтором команды.
 */
export function testTrace(requestId?: string): Trace {
  issued += 1;
  return Trace.fromRequest({ requestId: requestId ?? `r-${issued}` });
}
