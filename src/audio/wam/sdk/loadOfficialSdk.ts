import {
  OFFICIAL_WAM_SDK_LICENSE,
  OFFICIAL_WAM_SDK_PACKAGE,
  OFFICIAL_WAM_SDK_VERSION,
} from '../types';

export interface OfficialWamSdkLoad {
  packageName: typeof OFFICIAL_WAM_SDK_PACKAGE;
  version: typeof OFFICIAL_WAM_SDK_VERSION;
  license: typeof OFFICIAL_WAM_SDK_LICENSE;
  /** Present only when the SDK could actually be evaluated in this context. */
  module: unknown | null;
  unavailableReason?: string;
}

/** Named exports the host relies on; a load missing these is not usable. */
const REQUIRED_SDK_EXPORTS = ['WebAudioModule', 'WamNode', 'addFunctionModule'] as const;

let cached: OfficialWamSdkLoad | null = null;

function result(module: unknown | null, unavailableReason?: string): OfficialWamSdkLoad {
  return {
    packageName: OFFICIAL_WAM_SDK_PACKAGE,
    version: OFFICIAL_WAM_SDK_VERSION,
    license: OFFICIAL_WAM_SDK_LICENSE,
    module,
    ...(unavailableReason ? { unavailableReason } : {}),
  };
}

/**
 * Lazy-load `@webaudiomodules/sdk@0.0.12`.
 *
 * **Why the specifier is a bare literal and carries no vite-ignore pragma.**
 * Phase A used a runtime variable plus that pragma because the package was not
 * in `package.json` — it kept the build green but meant the import could never
 * succeed: a bare specifier left untransformed is unresolvable in a browser, so
 * the loader always fell into its catch. Now that the SDK is a pinned
 * devDependency, a literal specifier lets Rollup resolve it and emit it as its
 * own async chunk. That is what actually satisfies the Phase A bundle rule —
 * **zero SDK bytes on the main entry**, because a dynamic import is a chunk
 * boundary — while making the load work for real. `WamHost.test.ts` asserts both
 * halves.
 *
 * Must still never be imported from `main.tsx` / `App.tsx`.
 *
 * The SDK evaluates `class WamNode extends AudioWorkletNode` at module scope, so
 * merely importing it throws a `ReferenceError` anywhere `AudioWorkletNode` is
 * undefined (Node, jsdom, and inside an AudioWorklet global scope). That is
 * checked up front so callers get an actionable reason instead of a stack trace.
 */
export async function loadOfficialWamSdk(): Promise<OfficialWamSdkLoad> {
  if (cached) return cached;

  if (typeof AudioWorkletNode === 'undefined') {
    cached = result(
      null,
      'AudioWorkletNode is undefined in this context; @webaudiomodules/sdk subclasses it at ' +
        'module scope and cannot be evaluated here (main thread of a real browser only).',
    );
    return cached;
  }

  try {
    const mod: Record<string, unknown> = await import('@webaudiomodules/sdk');
    const missing = REQUIRED_SDK_EXPORTS.filter((name) => mod[name] === undefined);
    if (missing.length) {
      cached = result(
        null,
        `@webaudiomodules/sdk loaded but is missing required export(s): ${missing.join(', ')}`,
      );
      return cached;
    }
    cached = result(mod);
    return cached;
  } catch (err) {
    // Not cached: a transient chunk-load failure should be retryable.
    return result(null, err instanceof Error ? err.message : String(err));
  }
}

/** Test seam: drop the memoized load. */
export function resetOfficialWamSdkCache(): void {
  cached = null;
}
