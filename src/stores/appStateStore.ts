/**
 * App-state store
 *
 * The bridge between `useAppState()` (one hook that owns ~25 sub-hooks' worth
 * of `useState`) and the components that read it. `AppStateProvider` publishes
 * each render's result here; components subscribe through
 * `useAppStateSelector` / `useAppStateSlice` (src/contexts/AppStateContext.tsx)
 * and re-render only when the value they selected changes.
 *
 * Two properties make selectors cheap to use:
 *
 * 1. **Function-valued fields are published as stable proxies.** Every
 *    `handleX` / `setX` in the raw state is a fresh closure on most renders.
 *    Publishing the raw identity would make a selector that returns a handler
 *    "change" on every state update, defeating the point. Instead each
 *    function field gets one proxy for the store's lifetime that forwards to
 *    the *latest* raw function, so the handler a consumer holds is never
 *    stale and never causes a re-render by itself.
 * 2. **An unchanged snapshot keeps its identity.** If a publish changes no
 *    data field, subscribers are not notified at all.
 *
 * Consequence for consumers: a function's identity no longer signals that its
 * closure changed. Derive values by *calling* the function inside a selector
 * (`useAppStateSelector((s) => s.canUndoSong())`) rather than putting it in a
 * `useMemo` dependency list and calling it in the memo body.
 */

type Listener = () => void;
type AnyFunction = (...args: never[]) => unknown;

export interface AppStateStore<T extends object> {
  subscribe: (listener: Listener) => () => void;
  getSnapshot: () => T;
  /**
   * Record a new render's state. Updates the function proxies' target and the
   * snapshot immediately, but does not notify — pair with `flush()` from a
   * layout effect. Splitting the two lets it run in an insertion effect, which
   * fires before any child layout effect and so keeps proxied handlers current
   * for child effects in the same commit, without scheduling updates from a
   * phase that forbids it.
   */
  commit: (next: T) => void;
  /** Notify subscribers if the last `commit()` changed any data field. */
  flush: () => void;
}

export function createAppStateStore<T extends object>(initial: T): AppStateStore<T> {
  const listeners = new Set<Listener>();
  const proxies = new Map<string, AnyFunction>();
  let raw = initial;
  let dirty = false;

  const stabilize = (next: T): T => {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(next)) {
      const value = (next as Record<string, unknown>)[key];
      if (typeof value === 'function') {
        let proxy = proxies.get(key);
        if (!proxy) {
          proxy = ((...args: never[]) =>
            ((raw as Record<string, AnyFunction>)[key] as (...a: never[]) => unknown)(...args)) as AnyFunction;
          proxies.set(key, proxy);
        }
        out[key] = proxy;
      } else {
        out[key] = value;
      }
    }
    return out as T;
  };

  let snapshot = stabilize(initial);

  const sameData = (a: T, b: T): boolean => {
    const aKeys = Object.keys(a);
    if (aKeys.length !== Object.keys(b).length) return false;
    for (const key of aKeys) {
      if (!Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false;
    }
    return true;
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    commit: (next) => {
      raw = next;
      const stabilized = stabilize(next);
      if (sameData(snapshot, stabilized)) return;
      snapshot = stabilized;
      dirty = true;
    },
    flush: () => {
      if (!dirty) return;
      dirty = false;
      listeners.forEach((listener) => listener());
    },
  };
}

export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  for (const key of aKeys) {
    if (!Object.hasOwn(b, key)) return false;
    if (!Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false;
  }
  return true;
}
