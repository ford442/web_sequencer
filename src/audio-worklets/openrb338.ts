// src/audio-worklets/openrb338.ts
// openrb-338 TB-303 voice — ABI contract + port stub (#1537 / #1544).
//
// openrb-338 (GPL-3.0-only) is a bit-exact reimplementation of the ReBirth
// 2.01 TB-303 written in Rust. Hyphon exposes its `Tb303` as two selectable
// 303 voices — `openrb338-vintage` and `openrb338-2.0` — driven by the same
// note / slide / accent / param path as every other 303 voice.
//
// Port path (chosen): the Rust `Tb303` + its tables are isolated into a small
// crate and compiled with `cargo build --target wasm32-unknown-unknown` to a
// **separate, optional** `openrb338.wasm` module. It is NOT linked into
// hyphon_native.wasm, so the GPL code stays in its own module (see
// docs/audio-engine/openrb338-voice.md for the license decision).
//
// This file is the contract that module must satisfy plus the detection the
// 303 worklet uses. Until the module ships, `isOpenrb338ModuleBundled()` is
// false and the worklet plays Stock Open303 for these voices, telling the
// main thread (`openrb338-unavailable`). The persisted voice id is kept, so a
// song saved today plays bit-exact once the module lands — no migration.
//
// Worklet-safe: no DOM, no fetch (see src/audio-worklets/tsconfig.json).

/** Persisted voice ids (stable forever — saved in songs). */
export const OPENRB338_VINTAGE_MODEL_ID = 'openrb338-vintage' as const;
export const OPENRB338_V2_MODEL_ID = 'openrb338-2.0' as const;

export type Openrb338ModelId = typeof OPENRB338_VINTAGE_MODEL_ID | typeof OPENRB338_V2_MODEL_ID;

/** ReBirth 2.01 sound modes: "Vintage" (the 1.x 303) and "2.0". */
export type Openrb338Mode = 'vintage' | 'v2';

/** Numeric mode id passed across the ABI (`openrb303_set_mode`). */
export const OPENRB338_MODE_IDS: Readonly<Record<Openrb338Mode, number>> = {
    vintage: 0,
    v2: 1,
};

/** ABI revision the worklet speaks. The module reports its own via `openrb303_abi_version`. */
export const OPENRB338_ABI_VERSION = 1;

/**
 * Whether this build bundles `openrb338.wasm`. Flipped (or replaced by a
 * build-time define) when the #1537 extraction lands. Kept a function so the
 * check site does not change when it becomes a runtime probe.
 */
export function isOpenrb338ModuleBundled(): boolean {
    return false;
}

export function isOpenrb338Model(id: string | undefined): id is Openrb338ModelId {
    return id === OPENRB338_VINTAGE_MODEL_ID || id === OPENRB338_V2_MODEL_ID;
}

/** Sound mode a voice id selects (`undefined` for non-openrb ids). */
export function openrb338ModeForModel(id: string | undefined): Openrb338Mode | undefined {
    if (id === OPENRB338_VINTAGE_MODEL_ID) return 'vintage';
    if (id === OPENRB338_V2_MODEL_ID) return 'v2';
    return undefined;
}

/**
 * Exports `openrb338.wasm` must provide (C ABI, `extern "C"` / `#[no_mangle]`
 * from the Rust wrapper crate). Handles are opaque u32 instance ids.
 *
 * Params use the shared Open303Param ids (`OPEN303_PARAM_IDS` in
 * open303/shared.ts) with the same normalized ranges the other 303 voices
 * take — cutoff, resonance, env mod, decay, accent, waveform, tuning,
 * volume — so `routeParam` needs no per-voice mapping. The wrapper converts
 * them to ReBirth knob positions (0–127) internally.
 *
 * Notes follow the hyphon mono-303 convention: a `note_on` while a note is
 * held is a slide (legato) and velocity > 100 is an accent (as
 * ACCENT_VELOCITY_THRESHOLD in open303_wrapper.cpp). Slide time is fixed by
 * the ReBirth model, which has no slide-time knob.
 */
export interface Openrb338Exports {
    readonly memory: WebAssembly.Memory;
    openrb303_abi_version(): number;
    /** New voice at `sampleRate` in `mode` (OPENRB338_MODE_IDS); 0 on failure. */
    openrb303_create(sampleRate: number, mode: number): number;
    openrb303_destroy(handle: number): void;
    openrb303_set_mode(handle: number, mode: number): void;
    openrb303_set_param(handle: number, paramId: number, value: number): void;
    openrb303_note_on(handle: number, note: number, velocity: number): void;
    openrb303_note_off(handle: number, note: number): void;
    openrb303_all_notes_off(handle: number): void;
    /** Pointer to a mono f32 render buffer of `maxFrames`, owned by the voice. */
    openrb303_buffer(handle: number, maxFrames: number): number;
    /** Render `frames` mono samples into the voice's buffer. */
    openrb303_render(handle: number, frames: number): void;
}

const REQUIRED_EXPORTS: readonly (keyof Openrb338Exports)[] = [
    'openrb303_abi_version',
    'openrb303_create',
    'openrb303_destroy',
    'openrb303_set_mode',
    'openrb303_set_param',
    'openrb303_note_on',
    'openrb303_note_off',
    'openrb303_all_notes_off',
    'openrb303_buffer',
    'openrb303_render',
];

/** True when `exports` satisfies the ABI at the revision this worklet speaks. */
export function supportsOpenrb338(exports: unknown): exports is Openrb338Exports {
    if (!exports || typeof exports !== 'object') return false;
    const x = exports as Record<string, unknown>;
    if (!(x.memory instanceof WebAssembly.Memory)) return false;
    for (const name of REQUIRED_EXPORTS) {
        if (typeof x[name] !== 'function') return false;
    }
    try {
        return (x.openrb303_abi_version as () => number)() === OPENRB338_ABI_VERSION;
    } catch {
        return false;
    }
}

/** Why the voice cannot play bit-exact right now (the stub's only answer). */
export const OPENRB338_UNAVAILABLE_REASON =
    'openrb-338 module (GPL-3.0-only, optional) is not bundled in this build — playing Stock Open303';
