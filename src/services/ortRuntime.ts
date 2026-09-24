// Single owner of the `onnxruntime-web` module and of `ort.env`.
//
// Three consumers need ONNX Runtime — Supertonic (TTS), HybridNeuralPipeline
// (neural vocoder) and CtcForcedAligner (forced alignment). `ort.env` is a
// process-wide singleton, so when each of them wrote it from its own init path
// the last writer silently won for all three, and whichever consumer ran first
// decided the wasm URL and thread count for the rest. That is the bug this
// module exists to remove: `configureOrt()` is the only code in the tree that
// assigns `ort.env.wasm.*`, it runs exactly once, and every consumer reaches
// the runtime through `loadOrt()`.
//
// The import is dynamic so ORT never lands in the entry chunk — it is a
// multi-megabyte dependency behind a feature (TTS) that most sessions never
// touch. See docs/PERFORMANCE_BUDGET.md#bundle-size-budget.
import type * as ort from 'onnxruntime-web';

export type Ort = typeof ort;

/**
 * `ort.env.wasm.wasmPaths` is deliberately NOT set.
 *
 * It used to point at jsDelivr, pinned to a hardcoded "1.23.2" while
 * package.json declared ^1.23.2 — so a patch bump would have served newer JS
 * against older binaries, silently. The fix is not to point it somewhere else:
 * it is to stop setting it at all.
 *
 * Vite already emits ORT's binary as a build asset and rewrites the runtime's
 * own reference to it — `new URL("ort-wasm-simd-threaded.jsep-<hash>.wasm",
 * import.meta.url)` in the emitted chunk. That default is strictly better than
 * anything we could assign here:
 *
 *   - it is self-hosted, so a headline feature does not depend on a third party
 *     and the binary stays inside our COOP/COEP (which ORT threading needs);
 *   - it resolves against the chunk's own URL, so it is correct under a
 *     subdirectory deploy without consulting BASE_URL;
 *   - it is content-hashed, so it caches properly across releases; and
 *   - it comes from the same resolved package as the JS that loads it, which
 *     makes version drift structurally impossible.
 *
 * Assigning `wasmPaths` overrides all of that with an unhashed, hand-built URL.
 * `scripts/check-release-dist.mjs` asserts the emitted binary is present and
 * that no CDN URL survives into the bundle.
 */

/**
 * Threads ORT's wasm backend may use.
 *
 * Multi-threaded ORT needs SharedArrayBuffer, which needs COOP+COEP. On a page
 * that is not cross-origin isolated, asking for >1 thread does not fail loudly
 * — ORT degrades to single-threaded — so we ask for 1 explicitly rather than
 * pretending the threads exist.
 *
 * Otherwise: roughly half the logical cores, so inference does not starve the
 * audio thread, capped at 4 because ORT's wasm backend stops scaling past that
 * for models this size.
 */
export function ortNumThreads(): number {
  if (typeof navigator === 'undefined') return 1;
  if (typeof globalThis.crossOriginIsolated === 'boolean' && !globalThis.crossOriginIsolated) {
    return 1;
  }
  const cores = navigator.hardwareConcurrency || 2;
  return Math.max(1, Math.min(4, Math.floor(cores / 2)));
}

let configured = false;

/**
 * The single writer of `ort.env`. Idempotent: the first call wins and later
 * calls are no-ops, so consumers may call it in any order without the result
 * depending on which of them initialised first.
 */
export function configureOrt(mod: Ort): void {
  if (configured) return;
  configured = true;
  mod.env.wasm.numThreads = ortNumThreads();
  mod.env.wasm.simd = true;
  // wasmPaths is intentionally left alone — see the note above.
}

let ortPromise: Promise<Ort> | null = null;

/**
 * Dynamically import ONNX Runtime Web, configuring `ort.env` exactly once.
 * The module promise is memoised, so concurrent callers share one fetch.
 */
export function loadOrt(): Promise<Ort> {
  if (!ortPromise) {
    ortPromise = import('onnxruntime-web').then((mod) => {
      configureOrt(mod);
      return mod;
    });
  }
  return ortPromise;
}

/**
 * Warm the ORT chunk during idle time, after the sequencer is interactive.
 *
 * Deferring ORT trades a smaller first paint for a cold multi-megabyte fetch on
 * first TTS use, which on a slow link is its own regression. Prefetching on the
 * idle callback gets the common case warm without ORT ever sitting on the
 * first-paint path — and deliberately not on the user-gesture path either: a
 * click that has to await a chunk fetch before `AudioContext.resume()` loses
 * its gesture token and audio never starts.
 *
 * Failures are swallowed on purpose. This is an optimisation; the real load
 * still happens through `loadOrt()` at the point of use, where errors surface.
 */
export function prefetchOrtWhenIdle(): void {
  if (typeof window === 'undefined' || ortPromise) return;

  const warm = () => {
    void loadOrt().catch(() => {
      // Prefetch is best-effort: reset so the real call can retry and report.
      ortPromise = null;
    });
  };

  const ric = (window as typeof window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  }).requestIdleCallback;

  if (typeof ric === 'function') {
    ric(warm, { timeout: 10_000 });
  } else {
    // Safari has no requestIdleCallback; a timeout keeps it off the critical path.
    window.setTimeout(warm, 3_000);
  }
}

/** Test seam: forget the memoised module and the "already configured" latch. */
export function __resetOrtRuntimeForTests(): void {
  ortPromise = null;
  configured = false;
}
