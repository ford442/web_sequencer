/**
 * Worklet-side debug logger (#1596 P4) — the AudioWorkletGlobalScope twin of
 * src/utils/log.ts, and with it the only `src/` files `no-console` lets call
 * `console.debug`.
 *
 * Every call site is on a control path (init, engine / model switch), never
 * inside `process()`, so there is nothing to batch per block: in a production
 * build `wlog` is a constant-false branch and no string reaches the main
 * thread's console at all. It is silent under Vitest (MODE === 'test').
 * `console.warn` / `console.error` stay direct for real failures.
 */

const enabled = import.meta.env.DEV && import.meta.env.MODE !== 'test';

export function wlog(...args: readonly unknown[]): void {
    if (enabled) console.debug(...args);
}
