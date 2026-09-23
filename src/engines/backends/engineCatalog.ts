/**
 * The one place that answers "what actually renders this waveform family?" (#1294).
 *
 * Before this existed there were two selection stories: `BackendRegistry`'s
 * ordered chain (which only knew webgpu/wam/rust/wav/js) and a ~130-line
 * per-prefix `if` ladder in `VoiceManager` (which knew wam/rust/wgsl/pyodide
 * and nothing about the registry). Families that appeared in neither — `cpp`
 * most of all — silently played an `OscillatorNode`.
 *
 * Now every `OscEngineId` resolves here to exactly one of:
 *   - `kind: 'backend'` — a registered `OscillatorBackend`; the realtime note
 *     path enters `BackendRegistry` at that backend and walks the single
 *     documented fallback order from there.
 *   - `kind: 'native-worklet'` — a C++ AudioWorklet in `hyphon_native` that
 *     owns its own voices. These never reach `Voice`; if one somehow does it is
 *     reported as a fallback rather than quietly rendered as a JS oscillator.
 */

import type { OscEngineId } from '../../utils/waveformParser';
import type { OscillatorBackendId } from './OscillatorBackend';

export interface BackendEngineEntry {
    kind: 'backend';
    /** Where the fallback walk starts for this family. */
    backendId: OscillatorBackendId;
    /** Shown in the HUD / telemetry. */
    label: string;
}

export interface NativeEngineEntry {
    kind: 'native-worklet';
    /** Manager that owns the worklet voices. */
    owner: string;
    label: string;
}

export type EngineEntry = BackendEngineEntry | NativeEngineEntry;

export const ENGINE_CATALOG: Record<OscEngineId, EngineEntry> = {
    js: { kind: 'backend', backendId: 'js', label: 'JS oscillator' },
    wav: { kind: 'backend', backendId: 'wav', label: 'WAV PCM' },
    // AssemblyScript wavetable kernel. Named `wam` for persisted-state
    // compatibility only — it is NOT Web Audio Modules 2.0 (ADR 0001).
    wam: { kind: 'backend', backendId: 'wam', label: 'WASM OSC' },
    wgsl: { kind: 'backend', backendId: 'webgpu', label: 'WebGPU' },
    pyodide: { kind: 'backend', backendId: 'pyodide', label: 'Pyodide' },
    '303': { kind: 'native-worklet', owner: 'Open303Manager', label: 'Open303 / JC303' },
    prophecy: { kind: 'native-worklet', owner: 'ProphecyManager', label: 'Prophecy' },
};

export function engineEntry(engine: OscEngineId): EngineEntry {
    return ENGINE_CATALOG[engine];
}

/**
 * Backend the fallback walk starts at, or null when the family is owned by a
 * native worklet (and so must not be rendered by `Voice` at all).
 */
export function backendIdForEngine(engine: OscEngineId): OscillatorBackendId | null {
    const entry = ENGINE_CATALOG[engine];
    return entry.kind === 'backend' ? entry.backendId : null;
}

export function engineLabel(engine: OscEngineId): string {
    return ENGINE_CATALOG[engine].label;
}
