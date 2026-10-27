/**
 * Milliseconds from `performance.now()` where the scope has it (window, worker,
 * Node), else `Date.now()`. AudioWorkletGlobalScope does not expose
 * `performance` in every engine, so worklet code must not name it directly;
 * src/shared/rt is compiled without either global set, hence the lookup.
 */
export function nowMs(): number {
  const perf = (globalThis as { performance?: { now?: () => number } }).performance;
  return typeof perf?.now === 'function' ? perf.now() : Date.now();
}
