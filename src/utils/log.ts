// @mode: typescript
/**
 * The app's one console front door (#1596 P4). `no-console` (eslint.config.js)
 * bans `console.log` / `info` / `debug` everywhere in `src/` except here and in
 * the worklet twin `src/audio-worklets/wlog.ts`; `console.warn` / `error` stay
 * allowed so failure paths need no import.
 *
 *  - `log.debug` — development chatter (init steps, sizes, chosen variants).
 *    Prints only in a dev build or with `?debug` in the page URL; in a
 *    production build it is a no-op unless that flag is set, and it is
 *    always silent under Vitest (MODE === 'test') so suites stay quiet.
 *  - `log.info`  — something a user or a bug report wants to see (a feature
 *    off and why, a report the user asked for). Always prints.
 *  - `log.warn` / `log.error` — same as the console methods.
 *
 * Each call looks up `console.*` when it runs, never a bound copy taken at
 * import, so `vi.spyOn(console, 'info')` in a test still sees the call.
 * Safe in workers and AudioWorkletGlobalScope: `location` is read through
 * `globalThis` and may be absent.
 */

type LogArgs = readonly unknown[];

function urlHasDebugFlag(): boolean {
    try {
        const search = (globalThis as { location?: { search?: unknown } }).location?.search;
        return typeof search === 'string' && new URLSearchParams(search).has('debug');
    } catch {
        return false;
    }
}

const debugEnabled =
    (import.meta.env.DEV && import.meta.env.MODE !== 'test') || urlHasDebugFlag();

export const log = {
    /** True when `log.debug` prints; guard expensive argument building with it. */
    debugEnabled,
    debug(...args: LogArgs): void {
        if (debugEnabled) console.debug(...args);
    },
    info(...args: LogArgs): void {
        console.info(...args);
    },
    warn(...args: LogArgs): void {
        console.warn(...args);
    },
    error(...args: LogArgs): void {
        console.error(...args);
    },
} as const;
