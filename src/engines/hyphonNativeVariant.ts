/**
 * Which hyphon_native link profile the voice worklets load (#1229 follow-up).
 *
 * emscripten/build.sh emits two modules from the same voice sources:
 *   - hyphon_native.wasm     — pthread build, `shared: true` imported memory
 *   - hyphon_native.st.wasm  — single-threaded build, plain imported memory
 *
 * Every Open303 / Prophecy voice on one AudioContext takes handles on a single
 * instance (src/audio-worklets/hyphonNativeSession.ts), so the choice is made
 * once per context and every later voice follows it. A voice that asks for a
 * different profile after the context is bound gets the bound one and a loud
 * warning — it cannot get its own heap.
 *
 * See docs/wasm/BUILD_NOTES.md#threading-profiles.
 */
import {
    HYPHON_NATIVE_ARTIFACTS,
    type HyphonNativeArtifact,
    type HyphonNativeThreading,
} from '../audio-worklets/hyphonNativeImports';
import { isAppleWebKit } from '../utils/engineTelemetry';
import type { Open303Config } from './Open303Params';

export interface HyphonNativeEnvironment {
    /** `self.crossOriginIsolated` — COOP/COEP are in effect. */
    crossOriginIsolated: boolean;
    /** `SharedArrayBuffer` is exposed at all. */
    sharedArrayBuffer: boolean;
    /** Safari / Playwright WebKit. */
    appleWebKit: boolean;
}

export interface HyphonNativeSelection {
    artifact: HyphonNativeArtifact;
    /** Human-readable reason, surfaced in telemetry and the console. */
    reason: string;
}

export function detectHyphonNativeEnvironment(): HyphonNativeEnvironment {
    const g = globalThis as { crossOriginIsolated?: boolean };
    return {
        crossOriginIsolated: g.crossOriginIsolated === true,
        sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
        appleWebKit: isAppleWebKit(),
    };
}

/** Pure policy: pthread only when it is both allowed and asked for. */
export function selectHyphonNativeThreading(
    config: Pick<Open303Config, 'forceSingleThreaded'> | undefined,
    env: HyphonNativeEnvironment,
): { threading: HyphonNativeThreading; reason: string } {
    if (config?.forceSingleThreaded) {
        return { threading: 'st', reason: 'forceSingleThreaded' };
    }
    if (env.appleWebKit) {
        return { threading: 'st', reason: 'WebKit (pthread hyphon_native not used in Safari AudioWorklet)' };
    }
    if (!env.crossOriginIsolated || !env.sharedArrayBuffer) {
        return { threading: 'st', reason: 'page is not crossOriginIsolated (COOP/COEP missing)' };
    }
    return { threading: 'pthread', reason: 'crossOriginIsolated' };
}

const bound = new WeakMap<object, HyphonNativeSelection>();

/**
 * Resolve (and bind) the hyphon_native profile for an audio context.
 *
 * The first voice to init on a context decides; the rest reuse that decision so
 * the worklet session instantiates exactly one module.
 */
export function resolveHyphonNativeArtifact(
    audioContext: object,
    config?: Pick<Open303Config, 'forceSingleThreaded'>,
    env: HyphonNativeEnvironment = detectHyphonNativeEnvironment(),
): HyphonNativeSelection {
    const wanted = selectHyphonNativeThreading(config, env);
    const existing = bound.get(audioContext);
    if (existing) {
        if (existing.artifact.threading !== wanted.threading) {
            console.warn(
                `[HyphonNative] voice asked for the ${wanted.threading} build (${wanted.reason}) but this ` +
                `audio session already runs ${existing.artifact.threading} (${existing.reason}); ` +
                'all voices share one instance, so the bound build is used.',
            );
        }
        return existing;
    }
    const selection: HyphonNativeSelection = {
        artifact: HYPHON_NATIVE_ARTIFACTS[wanted.threading],
        reason: wanted.reason,
    };
    bound.set(audioContext, selection);
    console.log(
        `[HyphonNative] audio session uses ${selection.artifact.wasm} (${selection.reason})`,
    );
    return selection;
}

/** Telemetry backend name for a loaded profile. */
export function hyphonNativeBackendName(threading: HyphonNativeThreading): 'wasm-native' | 'wasm-native-st' {
    return threading === 'st' ? 'wasm-native-st' : 'wasm-native';
}
