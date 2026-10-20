// src/audio-worklets/nativeVoiceProcessor.ts
// Base for the AudioWorklet processors that play hyphon_native voices on the
// shared voice core (emscripten/core/voice.h, #1344 P4).
//
// Every voice processor used to hand-roll the same scaffolding — attach to the
// audio session's hyphon_native instance, keep a heap view, apply note / param
// messages the moment they arrived (or via a TS queue to the next block), copy
// the rendered block out. This class owns that once:
//
//   - one shared hyphon_native session per audio context (hyphonNativeSession)
//   - audioTime → absolute frame on the AudioContext clock, pushed into the
//     voice's native event ring; the engine applies it on that exact sample
//   - prefix_render(handle, blockStartFrame, frames) + copy to the outputs
//   - per-block perf reporting and bounded error logging

import { NATIVE_VOICE_MAX_BLOCK_FRAMES } from './hyphonNativeImports';
import { acquireHyphonNativeSession, type HyphonNativeInitData, type HyphonNativeSession } from './hyphonNativeSession';
import type { HyphonNativeExports, VoiceHandle, WasmPtr } from './hyphonNativeExports';
import { WorkletPerfReporter } from './workletPerfReporter';

declare class AudioWorkletProcessor {
    readonly port: MessagePort;
    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}
declare const currentFrame: number | undefined;
declare const sampleRate: number | undefined;

const VOICE_PREFIXES = ['open303', 'jc303', 'highfid303', 'prophecy', 'drumkit', 'macro'] as const;

/** Engines on the voice core — the prefix of their generic exports. */
export type NativeVoicePrefix = (typeof VOICE_PREFIXES)[number];

/**
 * Each engine's generic export names, built once at load: process() and the
 * message handler look them up without building a string on the audio thread.
 */
const VOICE_EXPORT_NAMES = Object.fromEntries(VOICE_PREFIXES.map((p) => [p, {
    pushEvent: `${p}_push_event`,
    render: `${p}_render`,
    cancelNotes: `${p}_cancel_notes`,
    flush: `${p}_flush`,
}])) as Record<NativeVoicePrefix, { pushEvent: string; render: string; cancelNotes: string; flush: string }>;

/** One voice: which engine, and its handle on the shared instance. */
export interface NativeVoiceRef {
    readonly prefix: NativeVoicePrefix;
    readonly handle: VoiceHandle;
}

type PushEvent = (h: VoiceHandle, frame: number, type: number, target: number, value: number,
    a0: number, a1: number, a2: number, a3: number) => number;
type Render = (h: VoiceHandle, blockStartFrame: number, frames: number) => WasmPtr;
type HandleCall = (h: VoiceHandle) => void;

/** At most this many messages per kind of failure, so a broken voice cannot flood the console. */
const MAX_LOGGED_ERRORS = 5;

export abstract class NativeVoiceProcessor extends AudioWorkletProcessor {
    protected static readonly MAX_BLOCK_FRAMES = NATIVE_VOICE_MAX_BLOCK_FRAMES;

    protected native: HyphonNativeSession | null = null;
    protected disposed = false;
    protected rateHz: number;
    protected readonly perf: WorkletPerfReporter;
    protected readonly logPrefix: string;

    private heap: Float32Array | null = null;
    private detach: (() => void) | null = null;
    private blockFrame = 0;
    /** Block clock for scopes without `currentFrame` (unit tests). */
    private nextFallbackFrame = 0;
    private renderErrors = 0;
    private processErrors = 0;
    private droppedEvents = 0;
    private readonly heapMessage: { type: 'hyphon-heap'; data: unknown } = { type: 'hyphon-heap', data: undefined };

    protected constructor(perfName: string, logPrefix: string) {
        super();
        this.perf = new WorkletPerfReporter(this.port, perfName);
        this.logPrefix = logPrefix;
        this.rateHz = typeof sampleRate === 'number' && sampleRate > 0 ? sampleRate : 48000;
    }

    /** The session's exports, typed. Only meaningful once a session is attached. */
    protected get x(): HyphonNativeExports & Record<string, (...args: never[]) => unknown> {
        return (this.native?.exports ?? {}) as HyphonNativeExports & Record<string, (...args: never[]) => unknown>;
    }

    // ── Session ──────────────────────────────────────────────────────────────

    /**
     * Join the audio session's hyphon_native instance (instantiating it if this
     * is the first voice). `sampleRateHz` is the context rate the main thread
     * reported, used when the scope has no `sampleRate` global.
     */
    protected async attachSession(data: HyphonNativeInitData, sampleRateHz?: number): Promise<HyphonNativeSession> {
        if (typeof sampleRate !== 'number' && typeof sampleRateHz === 'number' && sampleRateHz > 0) {
            this.rateHz = sampleRateHz;
        }
        const native = await acquireHyphonNativeSession(data, this.logPrefix);
        if (this.disposed) return native;
        this.native = native;
        this.refreshHeap();
        native.retain();
        const unsubscribe = native.onHeapGrow((stats) => {
            this.refreshHeap();
            this.heapMessage.data = stats;
            this.port.postMessage(this.heapMessage);
        });
        this.detach = () => {
            unsubscribe();
            native.release();
        };
        return native;
    }

    /**
     * Use a session another component acquired and retains (the 303 engine
     * session). This processor then renders and pushes events through it but
     * does not release it.
     */
    protected adoptSession(native: HyphonNativeSession, sampleRateHz?: number): void {
        if (typeof sampleRate !== 'number' && typeof sampleRateHz === 'number' && sampleRateHz > 0) {
            this.rateHz = sampleRateHz;
        }
        this.native = native;
        this.refreshHeap();
    }

    /** Give up this processor's hold on the shared instance (handles must be destroyed first). */
    protected releaseSession(): void {
        this.detach?.();
        this.detach = null;
        this.heap = null;
    }

    // ── Frames ───────────────────────────────────────────────────────────────

    /**
     * Absolute frame for an audioTime from the main thread. Anything missing,
     * zero or already past lands on the first frame of the next block.
     */
    protected frameAt(audioTime: unknown): number {
        return typeof audioTime === 'number' && audioTime > 0 && Number.isFinite(audioTime)
            ? Math.round(audioTime * this.rateHz)
            : 0;
    }

    /** Fix the first frame of the block process() is about to render. */
    protected beginBlock(frames: number): number {
        this.blockFrame = typeof currentFrame === 'number' ? currentFrame : this.nextFallbackFrame;
        this.nextFallbackFrame = this.blockFrame + frames;
        return this.blockFrame;
    }

    // ── Events ───────────────────────────────────────────────────────────────

    /** Queue one event on `voice` for `frame`. False when the voice's ring is full. */
    protected pushEvent(
        voice: NativeVoiceRef,
        frame: number,
        type: number,
        target: number,
        value: number,
        a0 = 0,
        a1 = 0,
        a2 = 0,
        a3 = 0,
    ): boolean {
        const push = this.x[VOICE_EXPORT_NAMES[voice.prefix].pushEvent] as PushEvent | undefined;
        if (!push) return false;
        if (push(voice.handle, frame, type, target, value, a0, a1, a2, a3) === 1) return true;
        if (this.droppedEvents++ < MAX_LOGGED_ERRORS) {
            console.warn(`${this.logPrefix} ${voice.prefix} event ring full — dropped event type ${type}`);
        }
        return false;
    }

    /** Drop the notes and triggers `voice` still holds for later frames; params still land. */
    protected cancelNotes(voice: NativeVoiceRef): void {
        (this.x[VOICE_EXPORT_NAMES[voice.prefix].cancelNotes] as HandleCall | undefined)?.(voice.handle);
    }

    /** Apply everything `voice` holds now — before it stops being rendered. */
    protected flushEvents(voice: NativeVoiceRef): void {
        (this.x[VOICE_EXPORT_NAMES[voice.prefix].flush] as HandleCall | undefined)?.(voice.handle);
    }

    // ── Render ───────────────────────────────────────────────────────────────

    /**
     * Render this block of `voice` (frame from beginBlock) and write it, times
     * `gain`, to both channels. False — with the channels silenced — on failure.
     */
    protected renderVoice(
        voice: NativeVoiceRef,
        frames: number,
        left: Float32Array | undefined,
        right: Float32Array | undefined,
        gain = 1,
    ): boolean {
        const render = this.x[VOICE_EXPORT_NAMES[voice.prefix].render] as Render | undefined;
        const ptr = render ? render(voice.handle, this.blockFrame, frames) : 0;
        return this.copyOut(ptr, frames, left, right, gain, VOICE_EXPORT_NAMES[voice.prefix].render);
    }

    /**
     * Render this block of a planar-stereo voice (NativeVoice<E, N, 2>: left
     * at the returned pointer, right `stride` floats on — the maxFrames it was
     * initialised with) into the two channels, times `gain`.
     */
    protected renderVoiceStereo(
        voice: NativeVoiceRef,
        frames: number,
        stride: number,
        left: Float32Array | undefined,
        right: Float32Array | undefined,
        gain = 1,
    ): boolean {
        const render = this.x[VOICE_EXPORT_NAMES[voice.prefix].render] as Render | undefined;
        const ptr = render ? render(voice.handle, this.blockFrame, frames) : 0;
        this.refreshHeap();
        const heap = this.heap;
        const offset = ptr > 0 ? ptr >>> 2 : -1;
        if (!heap || offset < 0 || frames > stride || offset + stride + frames > heap.length) {
            if (this.renderErrors++ < MAX_LOGGED_ERRORS) {
                console.error(`${this.logPrefix} ${voice.prefix}_render returned an unreadable stereo buffer (ptr=${ptr})`);
            }
            NativeVoiceProcessor.silence(left, right);
            return false;
        }
        const r = offset + stride;
        for (let i = 0; i < frames; i++) {
            if (left) left[i] = heap[offset + i] * gain;
            if (right) right[i] = heap[r + i] * gain;
        }
        return true;
    }

    /** Copy `frames` mono samples at `ptr` to both channels. */
    protected copyOut(
        ptr: WasmPtr,
        frames: number,
        left: Float32Array | undefined,
        right: Float32Array | undefined,
        gain: number,
        source: string,
    ): boolean {
        this.refreshHeap();
        const heap = this.heap;
        const offset = ptr > 0 ? ptr >>> 2 : -1;
        if (!heap || offset < 0 || offset + frames > heap.length) {
            if (this.renderErrors++ < MAX_LOGGED_ERRORS) {
                console.error(`${this.logPrefix} ${source} returned an unreadable buffer (ptr=${ptr})`);
            }
            NativeVoiceProcessor.silence(left, right);
            return false;
        }
        for (let i = 0; i < frames; i++) {
            const s = heap[offset + i] * gain;
            if (left) left[i] = s;
            if (right) right[i] = s;
        }
        return true;
    }

    /** Log a thrown process() error (bounded) and silence the block. */
    protected processFailed(e: unknown, left: Float32Array | undefined, right: Float32Array | undefined): void {
        if (this.processErrors++ < MAX_LOGGED_ERRORS) console.error(`${this.logPrefix} process() error:`, e);
        NativeVoiceProcessor.silence(left, right);
    }

    protected static silence(left: Float32Array | undefined, right: Float32Array | undefined): void {
        left?.fill(0);
        right?.fill(0);
    }

    private refreshHeap(): void {
        const memory = this.native?.memory;
        if (memory && this.heap?.buffer !== memory.buffer) this.heap = new Float32Array(memory.buffer);
    }
}
