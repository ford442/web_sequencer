/**
 * Offline render of the macro engine family (freeze, stems, AI preview, XM
 * one-shots).
 *
 * Not a port: the same hyphon_native.wasm the macro-processor worklet runs,
 * instantiated privately on whatever thread calls this (main thread or a
 * worker — no AudioWorklet involved), in its single-threaded profile with a
 * plain memory. Notes go in as voice-core events on their exact frames, so an
 * offline render of a pattern matches what the live part plays for it, voice
 * allocation, glide and all.
 *
 * When the wasm cannot be loaded, or predates the macro family, the caller
 * renders the model's documented fallback waveform instead and reports the
 * substitution (see renderSynthPattern / renderSynthToBuffer).
 */

import type { MacroSynthParams, SynthParams } from '../../types';
import {
    buildHyphonWasmImports,
    HYPHON_NATIVE_ARTIFACTS,
    hasMacroApi,
    normalizeWasmExports,
} from '../../audio-worklets/hyphonNativeImports';
import { configureWasmStack } from '../../audio-worklets/hyphonNativeSession';
import { loadHyphonWasmExportMap, logWaveformSubstitution, resolvePublicAsset } from '../../utils/engineTelemetry';
import { createOfflineBuffer } from './createOfflineContext';
import { getPitchOffsetSemitones } from '../../utils/pitchOffset';
import { MacroParam, macroNativeParams, resolveMacroParams, type MacroEngineInfo } from '../../engines/MacroParams';

/** Frames per render call; the planar stride of the offline voice. */
export const OFFLINE_MACRO_BLOCK = 4096;

/** hyphon::EventType values (emscripten/core/voice.h). */
const NOTE_ON = 1;
const NOTE_OFF = 2;
const PARAM = 4;

/** One note of an offline render, in seconds from the render start. */
export interface OfflineMacroNote {
    midi: number;
    /** 0–1. */
    velocity: number;
    startSeconds: number;
    durationSeconds: number;
    /** Glide in from the previous pitch (legato when the part is mono). */
    slide?: boolean;
    /** Per-note TIMBRE offset −1…1. */
    timbre?: number;
    /** Per-note knob values (pattern automation lanes) for this note's onset. */
    macro?: MacroSynthParams;
}

export interface OfflineMacroRequest {
    params: SynthParams;
    engine: MacroEngineInfo;
    notes: readonly OfflineMacroNote[];
    durationSeconds: number;
    sampleRate: number;
}

/** The slice of the hyphon_native exports an offline macro render needs. */
export interface OfflineMacroApi {
    memory: WebAssembly.Memory;
    macro_create(): number;
    macro_destroy(h: number): void;
    macro_init(h: number, sampleRate: number, maxFrames: number): number;
    macro_set_param(h: number, id: number, value: number): void;
    macro_push_event(h: number, frame: number, type: number, target: number, value: number, a0: number, a1: number, a2: number, a3: number): number;
    macro_render(h: number, blockStartFrame: number, frames: number): number;
    macro_engine_count(): number;
}

interface TimedEvent {
    frame: number;
    order: number;
    push(api: OfflineMacroApi, h: number): void;
}

/**
 * Render `request` on `api`: planar stereo, `durationSeconds` long. Pure apart
 * from the wasm calls, so tests can drive it with a fake API.
 */
export function renderMacroOffline(api: OfflineMacroApi, request: OfflineMacroRequest): [Float32Array, Float32Array] {
    const { params, engine, notes, sampleRate } = request;
    const frames = Math.max(1, Math.ceil(request.durationSeconds * sampleRate));
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);

    if (engine.index >= api.macro_engine_count()) {
        throw new Error(`hyphon_native knows ${api.macro_engine_count()} macro models; ${engine.label} is #${engine.index}`);
    }
    const h = api.macro_create();
    if (!h) throw new Error('macro_create() returned no handle (all offline slots busy)');
    try {
        if (api.macro_init(h, sampleRate, OFFLINE_MACRO_BLOCK) !== 1) throw new Error('macro_init() failed');
        const base = resolveMacroParams(params.macro);
        const patch = (macro: Required<MacroSynthParams>) => {
            const native = macroNativeParams(engine, macro, params.volume);
            native.push([MacroParam.TRANSPOSE, getPitchOffsetSemitones(params)]);
            return native;
        };
        for (const [id, value] of patch(base)) api.macro_set_param(h, id, value);

        // Every note is a noteOn and a noteOff on its own frame; per-note knob
        // values go in as params on the onset frame, ahead of the note, and the
        // part's own values come back on the next onset that has none.
        const events: TimedEvent[] = [];
        let order = 0;
        let previousOverride = false;
        const sorted = [...notes].sort((a, b) => a.startSeconds - b.startSeconds);
        for (const note of sorted) {
            const on = Math.round(note.startSeconds * sampleRate);
            const off = Math.max(on + 1, Math.round((note.startSeconds + note.durationSeconds) * sampleRate));
            if (note.macro || previousOverride) {
                const values = patch(note.macro ? resolveMacroParams({ ...params.macro, ...note.macro }) : base);
                events.push({
                    frame: on,
                    order: order++,
                    push: (a, handle) => {
                        for (const [id, value] of values) a.macro_push_event(handle, on, PARAM, id, value, 0, 0, 0, 0);
                    },
                });
                previousOverride = !!note.macro;
            }
            const velocity = Math.max(0, Math.min(1, note.velocity));
            events.push({
                frame: on,
                order: order++,
                push: (a, handle) => a.macro_push_event(handle, on, NOTE_ON, note.midi, velocity, note.timbre ?? 0, note.slide ? 1 : 0, 0, 0),
            });
            events.push({
                frame: off,
                order: order++,
                push: (a, handle) => a.macro_push_event(handle, off, NOTE_OFF, note.midi, 0, 0, 0, 0, 0),
            });
        }
        events.sort((a, b) => a.frame - b.frame || a.order - b.order);

        // The voice's event ring holds 256: feed it a block at a time.
        let next = 0;
        for (let start = 0; start < frames; start += OFFLINE_MACRO_BLOCK) {
            const n = Math.min(OFFLINE_MACRO_BLOCK, frames - start);
            while (next < events.length && events[next].frame < start + n) events[next++].push(api, h);
            const ptr = api.macro_render(h, start, n);
            if (!ptr) throw new Error(`macro_render() failed at frame ${start}`);
            const heap = new Float32Array(api.memory.buffer);
            const l = ptr >>> 2;
            const r = l + OFFLINE_MACRO_BLOCK;
            left.set(heap.subarray(l, l + n), start);
            right.set(heap.subarray(r, r + n), start);
        }
    } finally {
        api.macro_destroy(h);
    }
    return [left, right];
}

let loading: Promise<OfflineMacroApi> | null = null;

/**
 * The offline instance: fetched, compiled and instantiated once per page and
 * reused (each render takes its own handle). Rejects — and is retried on the
 * next call — when the wasm is missing or has no macro_* API.
 */
export function loadOfflineMacroApi(): Promise<OfflineMacroApi> {
    if (!loading) {
        loading = instantiateOfflineMacro();
        loading.catch(() => {
            loading = null;
        });
    }
    return loading;
}

async function instantiateOfflineMacro(): Promise<OfflineMacroApi> {
    const artifact = HYPHON_NATIVE_ARTIFACTS.st;
    const response = await fetch(resolvePublicAsset(artifact.wasm));
    if (!response.ok) throw new Error(`${artifact.wasm} fetch HTTP ${response.status}`);
    return instantiateOfflineMacroFromBytes(await response.arrayBuffer(), await loadHyphonWasmExportMap('st'));
}

/** Instantiate the single-threaded hyphon_native from its bytes + export map (tests, workers). */
export async function instantiateOfflineMacroFromBytes(
    bytes: BufferSource,
    exportMap: Record<string, string>,
): Promise<OfflineMacroApi> {
    const module = await WebAssembly.compile(bytes);

    let instance: WebAssembly.Instance | null = null;
    let memory: WebAssembly.Memory | null = null;
    const built = buildHyphonWasmImports(
        module,
        {
            getWasmInstance: () => instance,
            getImportedMemory: () => memory,
            setImportedMemory: (m) => {
                memory = m;
            },
            onHeapUpdate: () => {},
            logPrefix: '[OfflineMacro]',
        },
        { isThreaded: false },
    );
    instance = await WebAssembly.instantiate(module, built.imports);
    const exports = normalizeWasmExports(instance.exports, exportMap) as Record<string, unknown>;
    configureWasmStack(exports);
    memory = built.memory ?? (instance.exports as { memory?: WebAssembly.Memory }).memory ?? null;
    if (!memory) throw new Error('hyphon_native has no memory');
    if (!hasMacroApi(exports)) throw new Error('hyphon_native has no macro_* API (built before the macro family)');
    return { ...(exports as unknown as Omit<OfflineMacroApi, 'memory'>), memory };
}

const reportedOffline = new Set<string>();

/**
 * Render `request` into an AudioBuffer (stereo, or the mid channel when
 * `channels` is 1). Null — after reporting the substitution once per model —
 * when the engine cannot run here; the caller then renders `engine.fallback`.
 */
export async function renderMacroBuffer(request: OfflineMacroRequest, channels: 1 | 2 = 2): Promise<AudioBuffer | null> {
    let rendered: [Float32Array, Float32Array];
    try {
        rendered = renderMacroOffline(await loadOfflineMacroApi(), request);
    } catch (e) {
        const { engine } = request;
        if (!reportedOffline.has(engine.waveform)) {
            reportedOffline.add(engine.waveform);
            logWaveformSubstitution(
                'macro-offline',
                'offline',
                engine.waveform,
                engine.fallback,
                `offline macro render unavailable: ${e instanceof Error ? e.message : String(e)}`,
            );
        }
        return null;
    }
    const [left, right] = rendered;
    const buffer = createOfflineBuffer({ channels, length: left.length, sampleRate: request.sampleRate });
    if (channels === 2) {
        buffer.copyToChannel(left, 0);
        buffer.copyToChannel(right, 1);
    } else {
        const mid = new Float32Array(left.length);
        for (let i = 0; i < mid.length; i++) mid[i] = 0.5 * (left[i] + right[i]);
        buffer.copyToChannel(mid, 0);
    }
    return buffer;
}

/** Test hook: forget the cached instance and the substitution reports. */
export function resetOfflineMacroApiForTests(): void {
    loading = null;
    reportedOffline.clear();
}
