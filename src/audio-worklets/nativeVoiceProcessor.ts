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
//   - the control-plane inbox (#1497): records an EventBus route sends, over
//     a SharedArrayBuffer ring or batched messages, drained into the voice at
//     block start
//   - the voice's own native ring, offered to the main thread on the pthread
//     build (#1497 P2): its route then writes records into hyphon_native
//     memory in place, and the voice takes them itself at block start

import { NATIVE_VOICE_MAX_BLOCK_FRAMES } from './hyphonNativeImports';
import { acquireHyphonNativeSession, type HyphonNativeInitData, type HyphonNativeSession } from './hyphonNativeSession';
import type { HyphonNativeExports, VoiceHandle, WasmPtr } from '../shared/rt/hyphonNativeExports';
import { frameAtTime } from '../shared/rt/audioClock';
import { createEventFields } from '../shared/rt/eventLayout';
import { isEventRing } from '../shared/rt/eventRing';
import { createEventInbox, type EventInbox, type RingTransport } from '../shared/rt/eventTransport';
import { WorkletPerfReporter } from './workletPerfReporter';

const VOICE_PREFIXES = ['open303', 'jc303', 'highfid303', 'prophecy', 'drumkit', 'macro'] as const;

/** Engines on the voice core — the prefix of their generic exports. */
export type NativeVoicePrefix = (typeof VOICE_PREFIXES)[number];

/**
 * Each engine's generic export names, built once at load: process() and the
 * message handler look them up without building a string on the audio thread.
 */
const VOICE_EXPORT_NAMES = Object.fromEntries(VOICE_PREFIXES.map((p) => [p, {
    pushEvent: `${p}_push_event` as keyof HyphonNativeExports,
    render: `${p}_render` as keyof HyphonNativeExports,
    cancelNotes: `${p}_cancel_notes` as keyof HyphonNativeExports,
    flush: `${p}_flush` as keyof HyphonNativeExports,
    eventInbox: `${p}_event_inbox` as keyof HyphonNativeExports,
}])) as Record<NativeVoicePrefix, Record<'pushEvent' | 'render' | 'cancelNotes' | 'flush' | 'eventInbox', keyof HyphonNativeExports>>;

/** One voice: which engine, and its handle on the shared instance. */
export interface NativeVoiceRef {
    prefix: NativeVoicePrefix;
    handle: VoiceHandle;
}

type PushEvent = (h: VoiceHandle, frame: number, type: number, target: number, value: number,
    a0: number, a1: number, a2: number, a3: number) => number;
type Render = (h: VoiceHandle, blockStartFrame: number, frames: number) => WasmPtr;
type HandleCall = (h: VoiceHandle) => void;
type EventInboxCall = (h: VoiceHandle) => WasmPtr;

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
    private inbox: EventInbox | null = null;
    /** One decoded record (EventField order): typed storage, so draining allocates nothing. */
    private readonly inboxFields = createEventFields();
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
        return frameAtTime(audioTime, this.rateHz);
    }

    /** Fix the first frame of the block process() is about to render. */
    protected beginBlock(frames: number): number {
        this.blockFrame = typeof currentFrame === 'number' ? currentFrame : this.nextFallbackFrame;
        this.nextFallbackFrame = this.blockFrame + frames;
        return this.blockFrame;
    }

    // ── Control-plane inbox (#1497) ──────────────────────────────────────────

    /**
     * Build the inbox for the transport the main thread's EventBus route sent
     * (EngineEventSink.transport) with the init message. Call it before the
     * first await, so a batch that follows the init message finds it. False,
     * with no inbox, when `transport` is missing or malformed.
     */
    protected attachEventInbox(transport: unknown): boolean {
        this.inbox = createEventInbox(transport);
        return this.inbox !== null;
    }

    /** Port hook, first in onmessage: true when `data` was an event batch, now queued. */
    protected receiveEvents(data: unknown): boolean {
        return this.inbox?.receive(data) ?? false;
    }

    /**
     * Move every record the inbox holds into `voice`'s native event ring, in
     * the order they were pushed. At block start, and before a cancel, so that
     * a stop also drops what the bus had queued. Returns how many moved.
     */
    protected drainEvents(voice: NativeVoiceRef): number {
        const inbox = this.inbox;
        if (!inbox || inbox.size === 0) return 0;
        const exports: Record<string, unknown> = this.x;
        const push = exports[VOICE_EXPORT_NAMES[voice.prefix].pushEvent] as PushEvent | undefined;
        if (!push) return 0;
        // Fields go from typed arrays straight into the wasm call, never boxed.
        const f = this.inboxFields;
        let moved = 0;
        while (inbox.popInto(f)) {
            if (push(voice.handle, f[0], f[1], f[2], f[3], f[4], f[5], f[6], f[7]) !== 1 && this.droppedEvents++ < MAX_LOGGED_ERRORS) {
                console.warn(`${this.logPrefix} ${voice.prefix} event ring full — dropped event type ${f[1]}`);
            }
            moved++;
        }
        return moved;
    }

    /**
     * Oldest record the inbox holds, into `out` (EventField order), for a
     * processor that routes records itself rather than to one voice (the 303).
     * False when there is none.
     */
    protected nextEvent(out: Float64Array): boolean {
        return this.inbox?.popInto(out) ?? false;
    }

    /**
     * `voice`'s own native event ring as a transport the main thread can write
     * in place (#1497 P2): the voice's inbox ring at its address in
     * hyphon_native's shared memory. Send it in the ready message. Null where
     * that cannot work — the memory is not shared (the single-threaded build:
     * a port would copy it), or the build predates prefix_event_inbox.
     */
    protected voiceRingTransport(voice: NativeVoiceRef): RingTransport | null {
        const buffer = this.native?.memory?.buffer;
        if (typeof SharedArrayBuffer === 'undefined' || !(buffer instanceof SharedArrayBuffer)) return null;
        const exports: Record<string, unknown> = this.x;
        const inbox = exports[VOICE_EXPORT_NAMES[voice.prefix].eventInbox] as EventInboxCall | undefined;
        const byteOffset = typeof inbox === 'function' ? inbox(voice.handle) : 0;
        // The C++ constructor laid it out; a mismatch means a stale build.
        if (!byteOffset || !isEventRing(buffer, byteOffset)) return null;
        return { kind: 'ring', buffer, byteOffset };
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
        const push = (this.x as any)[VOICE_EXPORT_NAMES[voice.prefix].pushEvent] as PushEvent | undefined;
        if (!push) return false;
        if (push(voice.handle, frame, type, target, value, a0, a1, a2, a3) === 1) return true;
        if (this.droppedEvents++ < MAX_LOGGED_ERRORS) {
            console.warn(`${this.logPrefix} ${voice.prefix} event ring full — dropped event type ${type}`);
        }
        return false;
    }

    /** Drop the notes and triggers `voice` still holds for later frames; params still land. */
    protected cancelNotes(voice: NativeVoiceRef): void {
        ((this.x as any)[VOICE_EXPORT_NAMES[voice.prefix].cancelNotes] as HandleCall | undefined)?.(voice.handle);
    }

    /** Apply everything `voice` holds now — before it stops being rendered. */
    protected flushEvents(voice: NativeVoiceRef): void {
        ((this.x as any)[VOICE_EXPORT_NAMES[voice.prefix].flush] as HandleCall | undefined)?.(voice.handle);
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
        const render = (this.x as any)[VOICE_EXPORT_NAMES[voice.prefix].render] as Render | undefined;
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
        const render = (this.x as any)[VOICE_EXPORT_NAMES[voice.prefix].render] as Render | undefined;
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
        // Optimize: use Float32Array.prototype.set for the default gain === 1 case,
        // and hoist existence checks outside of loops (loop unswitching)
        if (gain === 1) {
            if (left) left.set(heap.subarray(offset, offset + frames));
            if (right) right.set(heap.subarray(r, r + frames));
        } else if (left && right) {
            for (let i = 0; i < frames; i++) {
                left[i] = heap[offset + i] * gain;
                right[i] = heap[r + i] * gain;
            }
        } else {
            if (left) {
                for (let i = 0; i < frames; i++) left[i] = heap[offset + i] * gain;
            }
            if (right) {
                for (let i = 0; i < frames; i++) right[i] = heap[r + i] * gain;
            }
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
        // Optimize: use Float32Array.prototype.set for the default gain === 1 case,
        // and hoist existence checks outside of loops (loop unswitching)
        if (gain === 1) {
            const sub = heap.subarray(offset, offset + frames);
            if (left) left.set(sub);
            if (right) right.set(sub);
        } else if (left && right) {
            for (let i = 0; i < frames; i++) {
                const s = heap[offset + i] * gain;
                left[i] = s;
                right[i] = s;
            }
        } else {
            if (left) {
                for (let i = 0; i < frames; i++) left[i] = heap[offset + i] * gain;
            }
            if (right) {
                for (let i = 0; i < frames; i++) right[i] = heap[offset + i] * gain;
            }
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
