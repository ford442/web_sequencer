/**
 * EventBus: the main-thread hub of the real-time control plane (#1497).
 *
 * Every producer (step handler, automation, MIDI input, UI knobs, mutes)
 * enqueues frame-stamped records here for an engine's route. The bus owns
 * each route's one writer, an EngineEventSink (src/shared/rt/eventTransport.ts),
 * so a ring keeps a single producer however many parts of the app drive the
 * engine. A producer that holds a route never learns which transport is
 * underneath it.
 *
 * Batching: on the postMessage fallback the first push into a route in a task
 * schedules one microtask flush, so a tick's records reach the worklet as one
 * message. Before a port message that must arrive after a route's records
 * (a transport stop), call flush(route) yourself. Ring routes never need a
 * flush, and pushing into one schedules nothing.
 *
 * Allocation. The transport allocates nothing per record. The fallback's
 * flush copies its stage into one transferred buffer per tick. But V8 boxes a
 * double passed as an argument wherever it does not inline the call, so
 * push(…, 0.37) can cost a heap number per double. A hot producer writes the
 * shared `stage` (a Float64Array in EventField order) and calls commit(route)
 * instead, so its values never leave typed arrays.
 */

import { createEventFields } from '@/shared/rt/eventLayout';
import type { EngineEventSink, EventTransport } from '@/shared/rt/eventTransport';

/** An open engine route on a bus. 0 is never a route. */
export type EventRoute = number;

export interface EventBusOptions {
  /**
   * Flush message routes in a microtask after the first push of a task
   * (default true). Off, the owner calls flush() / flushAll() itself.
   */
  autoFlush?: boolean;
}

export class EventBus {
  /**
   * One record, filled in place by the producer about to commit() it (fields
   * at EventField indices). Everything runs on the main thread, so one stage
   * serves every producer; commit() clears it.
   */
  readonly stage: Float64Array = createEventFields();
  /** Index = route; slot 0 stays empty so a route is never falsy. */
  private readonly sinks: Array<EngineEventSink | null> = [null];
  private readonly autoFlush: boolean;
  private flushQueued = false;
  private unroutedCount = 0;
  private readonly flushQueuedRoutes = (): void => {
    this.flushQueued = false;
    this.flushAll();
  };

  constructor(options: EventBusOptions = {}) {
    this.autoFlush = options.autoFlush ?? true;
  }

  /** Give the bus an engine's sink. The bus is now its only writer. */
  open(sink: EngineEventSink): EventRoute {
    const free = this.sinks.indexOf(null, 1);
    if (free > 0) {
      this.sinks[free] = sink;
      return free;
    }
    this.sinks.push(sink);
    return this.sinks.length - 1;
  }

  /** Flush what the route still stages, then forget it. Closing twice is harmless. */
  close(route: EventRoute): void {
    const sink = route > 0 ? this.sinks[route] : null;
    if (!sink) return;
    sink.flush();
    this.sinks[route] = null;
  }

  /** The descriptor its worklet builds an inbox from, or null for a closed route. */
  transport(route: EventRoute): EventTransport | null {
    return this.sinks[route]?.transport ?? null;
  }

  /**
   * Queue one record for `route`. False when it was not queued: the route is
   * closed (counted in `unrouted`) or its transport is full (counted by it).
   */
  push(
    route: EventRoute,
    frame: number,
    type: number,
    target: number,
    value: number,
    a0 = 0,
    a1 = 0,
    a2 = 0,
    a3 = 0,
  ): boolean {
    const sink = route > 0 ? this.sinks[route] : undefined;
    if (!sink) {
      this.unroutedCount++;
      return false;
    }
    const queued = sink.push(frame, type, target, value, a0, a1, a2, a3);
    this.queueFlush(sink);
    return queued;
  }

  /**
   * Queue `stage` for `route` and clear it, ready for the next record. Same
   * result as push(), with no number passed as an argument.
   */
  commit(route: EventRoute): boolean {
    const sink = route > 0 ? this.sinks[route] : undefined;
    let queued = false;
    if (sink) {
      queued = sink.pushFrom(this.stage);
      this.queueFlush(sink);
    } else {
      this.unroutedCount++;
    }
    this.stage.fill(0);
    return queued;
  }

  /** Hand the route's staged records to its worklet now. */
  flush(route: EventRoute): void {
    if (route > 0) this.sinks[route]?.flush();
  }

  /** flush() every open route. */
  flushAll(): void {
    for (let i = 1; i < this.sinks.length; i++) {
      const sink = this.sinks[i];
      if (sink?.needsFlush) sink.flush();
    }
  }

  /** Records the route's transport refused (full), 0 for a closed route. */
  dropped(route: EventRoute): number {
    return this.sinks[route]?.dropped ?? 0;
  }

  private queueFlush(sink: EngineEventSink): void {
    if (this.autoFlush && !this.flushQueued && sink.needsFlush) {
      this.flushQueued = true;
      queueMicrotask(this.flushQueuedRoutes);
    }
  }

  /** Pushes to a closed or unknown route. */
  get unrouted(): number {
    return this.unroutedCount;
  }
}

/** The app's bus: every live engine opens its route here. */
export const engineEventBus = new EventBus();
