/**
 * Offline render of the analog 808/909 drum kit (XM one-shots, stems, freeze,
 * AI preview).
 *
 * The kit the user sequenced is the `drumkit_*` voice in hyphon_native
 * (DrumKitEngine → drumkit-processor). This renders hits through the very same
 * voice, instantiated privately on whatever thread calls it (see
 * offlineNative.ts) — the bounce is the live kit, not a second implementation
 * of it. Hits go in as voice-core events on their exact frames with the
 * trigger arguments the live engine packs (drumTriggerArgs).
 *
 * When the wasm cannot be loaded, or predates the drum kit, the caller renders
 * the live engine's own Web Audio fallback kit instead (see renderDrumToBuffer)
 * and the substitution is reported once.
 */

import type { DrumKitType, DrumSound, HatParams, KickParams, SnareParams } from '../../types';
import { hasDrumkitApi } from '../../audio-worklets/hyphonNativeImports';
import { DrumkitEvent, VoiceEvent } from '../../shared/rt/hyphonNativeExports';
import { DRUMKIT_VOICE, drumTriggerArgs, kitToNativeId } from '../../engines/DrumKitCharacter';
import { logEngineFallback } from '../../utils/engineTelemetry';
import { createOfflineBuffer } from './createOfflineContext';
import { loadOfflineNative, type OfflineNativeInstance } from './offlineNative';

/** Frames per render call; the planar stride of the offline voice. */
export const OFFLINE_DRUMKIT_BLOCK = 4096;

/** One hit of an offline render. */
export interface OfflineDrumHit {
    sound: DrumSound;
    params: KickParams | SnareParams | HatParams;
    /** Seconds from the render start. */
    startSeconds: number;
    /** −1…1; the step's pan, else the sound's own `params.pan`. */
    pan?: number;
}

export interface OfflineDrumkitRequest {
    kit: DrumKitType;
    hits: readonly OfflineDrumHit[];
    durationSeconds: number;
    sampleRate: number;
}

/** The slice of the hyphon_native exports an offline drum render needs. */
export interface OfflineDrumkitApi {
    memory: WebAssembly.Memory;
    drumkit_create(): number;
    drumkit_destroy(h: number): void;
    drumkit_init(h: number, sampleRate: number, maxFrames: number): number;
    drumkit_push_event(h: number, frame: number, type: number, target: number, value: number, a0: number, a1: number, a2: number, a3: number): number;
    drumkit_render(h: number, blockStartFrame: number, frames: number): number;
}

interface TimedEvent {
    frame: number;
    order: number;
    push(api: OfflineDrumkitApi, h: number): void;
}

/**
 * Render `request` on `api`: planar stereo, `durationSeconds` long. Pure apart
 * from the wasm calls, so tests can drive it with a fake API.
 */
export function renderDrumkitOffline(api: OfflineDrumkitApi, request: OfflineDrumkitRequest): [Float32Array, Float32Array] {
    const { kit, hits, sampleRate } = request;
    const frames = Math.max(1, Math.ceil(request.durationSeconds * sampleRate));
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);

    const h = api.drumkit_create();
    if (!h) throw new Error('drumkit_create() returned no handle (all offline slots busy)');
    try {
        if (api.drumkit_init(h, sampleRate, OFFLINE_DRUMKIT_BLOCK) !== 1) throw new Error('drumkit_init() failed');
        api.drumkit_push_event(h, 0, DrumkitEvent.SetKit, kitToNativeId(kit), 0, 0, 0, 0, 0);

        // Same pair of records DrumKitEngine writes per hit: the pan, then the
        // trigger, on one frame (the trigger latches the pan).
        const events: TimedEvent[] = [];
        let order = 0;
        for (const hit of [...hits].sort((a, b) => a.startSeconds - b.startSeconds)) {
            const frame = Math.max(0, Math.round(hit.startSeconds * sampleRate));
            const voice = DRUMKIT_VOICE[hit.sound];
            const pan = hit.pan ?? hit.params.pan ?? 0;
            const [a, b, c, d] = drumTriggerArgs(hit.sound, hit.params);
            events.push({
                frame,
                order: order++,
                push: (x, handle) => void x.drumkit_push_event(handle, frame, DrumkitEvent.SetPan, voice, pan, 0, 0, 0, 0),
            });
            events.push({
                frame,
                order: order++,
                push: (x, handle) => void x.drumkit_push_event(handle, frame, VoiceEvent.Trigger, voice, 1, a, b, c, d),
            });
        }
        events.sort((x, y) => x.frame - y.frame || x.order - y.order);

        // The voice's event ring holds 256: feed it a block at a time.
        let next = 0;
        for (let start = 0; start < frames; start += OFFLINE_DRUMKIT_BLOCK) {
            const n = Math.min(OFFLINE_DRUMKIT_BLOCK, frames - start);
            while (next < events.length && events[next].frame < start + n) events[next++].push(api, h);
            const ptr = api.drumkit_render(h, start, n);
            if (!ptr) throw new Error(`drumkit_render() failed at frame ${start}`);
            const heap = new Float32Array(api.memory.buffer);
            const l = ptr >>> 2;
            const r = l + OFFLINE_DRUMKIT_BLOCK;
            left.set(heap.subarray(l, l + n), start);
            right.set(heap.subarray(r, r + n), start);
        }
    } finally {
        api.drumkit_destroy(h);
    }
    return [left, right];
}

function drumkitApiOf({ exports, memory }: OfflineNativeInstance): OfflineDrumkitApi {
    if (!hasDrumkitApi(exports)) throw new Error('hyphon_native has no drumkit_* API (built before the drum kit)');
    return { ...(exports as unknown as Omit<OfflineDrumkitApi, 'memory'>), memory };
}

/** The drum kit API on the shared offline instance. Rejects when the wasm is missing or too old. */
export async function loadOfflineDrumkitApi(): Promise<OfflineDrumkitApi> {
    return drumkitApiOf(await loadOfflineNative());
}

let reported = false;

/**
 * Render `request` into an AudioBuffer (stereo, or the mid channel when
 * `channels` is 1). Null — after reporting the substitution once — when the
 * native kit cannot run here; the caller then renders the live engine's Web
 * Audio fallback kit.
 */
export async function renderDrumkitBuffer(request: OfflineDrumkitRequest, channels: 1 | 2 = 2): Promise<AudioBuffer | null> {
    let rendered: [Float32Array, Float32Array];
    try {
        rendered = renderDrumkitOffline(await loadOfflineDrumkitApi(), request);
    } catch (e) {
        if (!reported) {
            reported = true;
            logEngineFallback(
                'drumkit-offline',
                'wasm',
                'offline native drum kit unavailable, rendering the Web Audio fallback kit',
                e,
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

/** Test hook: forget the substitution report. */
export function resetOfflineDrumkitForTests(): void {
    reported = false;
}
