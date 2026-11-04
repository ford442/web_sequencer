/**
 * What an engine façade sent its worklet over the control plane (#1497), for
 * tests that stand a mock port in for the worklet's.
 *
 * Notes, params and stops travel as records on the façade's EventBus route.
 * Where memory is not shared (every unit test), that route posts them as
 * batches. postedRecords decodes those batches in order; postedTypes lists the
 * other port messages, the control messages that stay messages.
 */

import { engineEventBus } from '@/audio/controlPlane/EventBus';
import { createEventRecord, type EventRecord } from '@/shared/rt/eventLayout';
import { EventInbox, isEventBatchMessage } from '@/shared/rt/eventTransport';

interface MockPost {
  mock: { calls: unknown[][] };
}

/** Every record posted so far, oldest first. Flushes the app's bus first, so staged records count. */
export function postedRecords(postMessage: MockPost): EventRecord[] {
  engineEventBus.flushAll();
  const inbox = new EventInbox({ kind: 'message', capacity: 1 << 12 });
  for (const [message] of postMessage.mock.calls) inbox.receive(message);
  const out: EventRecord[] = [];
  for (let e = createEventRecord(); inbox.pop(e); e = createEventRecord()) out.push(e);
  return out;
}

/** The `type` of every posted message that is not a record batch, in order. */
export function postedTypes(postMessage: MockPost): string[] {
  engineEventBus.flushAll();
  return postMessage.mock.calls
    .map(([message]) => message)
    .filter((message) => !isEventBatchMessage(message))
    .map((message) => (message as { type?: string }).type ?? '');
}
