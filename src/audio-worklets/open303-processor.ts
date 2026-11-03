// src/audio-worklets/open303-processor.ts
// One TB-303 voice (bass1 / bass2 / lead303) on the audio session's shared
// hyphon_native instance: the custom open303 engine, the authentic jc303
// engine, or the live diode-ladder high-fid voice — and, for live A/B, stock
// open303 and high-fid side by side.
//
// Notes and params are voice-core events (#1344 P4): each becomes an event
// on its frame, pushed into the native ring of every voice being rendered,
// and the engine applies it on that exact sample. The mono-synth rules this
// worklet used to enforce in TypeScript — retrigger instead of slide, ignore a
// stale noteOff, release a stuck note after 8 s — run natively on the event
// frame (hyphon::MonoNoteEngine).
//
// They arrive as control-plane records (#1497 P2) from Open303Oscillator's
// EventBus route — a SharedArrayBuffer ring on the pthread build, batched
// messages elsewhere — drained at block start and routed here, because the
// voice a record goes to depends on the engine selection this worklet owns.
// The noteOn / noteOff / param / allNotesOff messages stay for tools and tests.

import { EventField, createEventFields } from '../shared/rt/eventLayout';
import { VoiceEvent } from '../shared/rt/hyphonNativeExports';
import { NativeVoiceProcessor, type NativeVoiceRef, type NativeVoicePrefix } from './nativeVoiceProcessor';
import { Open303EngineSession } from './open303/engineSession';
import { Open303EngineSelection } from './open303/engineSelection';
import { OPEN303_PARAM_IDS, getTime, type RequestedEngineFamily } from './open303/shared';

// jc303_set* message name → Open303Param id. The message protocol predates
// the native API; every engine shares these ids.
const JC303_PARAM_MAP: Record<string, number> = Object.fromEntries(
    Object.entries(OPEN303_PARAM_IDS).map(([setter, id]) => [`jc303_${setter}`, id]),
);

/** Payloads of the L2/L3 configuration messages. */
interface LiveHighFidMessageData {
    armed?: unknown;
    coefficients?: unknown;
    buffer?: unknown;
}

/** Fields the port messages carry; each message type reads a few of them. */
interface Open303MessageData extends LiveHighFidMessageData {
    note?: number;
    velocity?: number;
    func?: string;
    value?: number;
    audioTime?: number;
    engine?: RequestedEngineFamily;
    model?: string;
    oversample?: number;
    /** init-wasm: EngineEventSink.transport of the main thread's EventBus route. */
    events?: unknown;
}

class Open303Processor extends NativeVoiceProcessor {
    private readonly session = new Open303EngineSession(this.port);
    private readonly engineSelection = new Open303EngineSelection(this.session, this.port, () => this.clearAllNotes());

    // Mild makeup gain — hyphon_native 303 engines already run near full scale.
    private static readonly OUTPUT_GAIN = 1.0;

    /** Params/engine messages received before the worklet reaches READY. */
    private pendingMessages: Array<{ type: string; data: Open303MessageData | undefined }> = [];

    /** Voices rendered this block / param targets (reused, no per-message allocation). */
    private readonly rendered: NativeVoiceRef[] = [];
    private readonly paramTargets: NativeVoiceRef[] = [];
    /** One bus record being routed (EventField order): typed storage, no allocation. */
    private readonly record = createEventFields();

    constructor() {
        super('open303', '[Open303]');
        this.port.onmessage = this.handleMessage.bind(this);
    }

    private async handleMessage(event: MessageEvent) {
        if (this.receiveEvents(event.data)) return;
        const { type, data } = event.data as { type: string; data?: Open303MessageData };

        if (type === 'init-wasm') {
            // Before the first await: a batch that follows init-wasm must find it.
            this.attachEventInbox(data?.events);
            await this.session.initialize(data, () => {
                const native = this.session.nativeSession;
                if (native) this.adoptSession(native, this.session.sampleRateHz);
                this.flushPendingMessages();
            });
            return;
        }

        if (type === 'dispose') {
            // The hyphon_native instance is shared by every voice in this audio
            // session, so a dead node must hand its handles back explicitly —
            // they are no longer freed with a per-processor heap.
            this.disposed = true;
            this.pendingMessages = [];
            this.engineSelection.dispose();
            this.session.dispose();
            return;
        }

        if (!this.session.isReady) {
            if (Open303Processor.QUEUED_BEFORE_READY.has(type)) {
                this.pendingMessages.push({ type, data });
            }
            return;
        }

        this.dispatchMessage(type, data);
    }

    /** Configuration messages replayed once the worklet reaches READY. */
    private static readonly QUEUED_BEFORE_READY = new Set([
        'set-engine',
        'set-303-model',
        'param',
        'set-live-ab',
        'set-highfid-coeffs',
        'attach-highfid-coeff-table',
    ]);

    private dispatchMessage(type: string, data: Open303MessageData | undefined): void {
        if (type === 'noteOn' && data?.note !== undefined) {
            this.pushNote(VoiceEvent.NoteOn, data.note, data.velocity ?? 0, data.audioTime);
        } else if (type === 'noteOff' && data?.note !== undefined) {
            this.pushNote(VoiceEvent.NoteOff, data.note, 0, data.audioTime);
        } else if (type === 'allNotesOff') {
            this.releaseAllNotes();
        } else if (type === 'set-engine' && data?.engine !== undefined) {
            // set-engine predates the voices registry: only render families.
            if (data.engine !== 'openrb338') this.engineSelection.setEngine(data.engine);
        } else if (type === 'set-303-model' && data?.model !== undefined) {
            this.engineSelection.setModel(data.model, data.engine, data.oversample);
        } else if (type === 'param' && data?.func !== undefined && data.value !== undefined) {
            this.handleParam(data.func, data.value, data.audioTime);
        } else if (type === 'set-live-ab' || type === 'set-highfid-coeffs' || type === 'attach-highfid-coeff-table') {
            this.handleLiveHighFidMessage(type, data);
        }
    }

    private flushPendingMessages(): void {
        const queue = this.pendingMessages;
        this.pendingMessages = [];
        for (const msg of queue) this.dispatchMessage(msg.type, msg.data);
    }

    // ── Routing ──────────────────────────────────────────────────────────────

    private updateRef(arr: NativeVoiceRef[], idx: number, prefix: NativeVoicePrefix, handle: number | bigint): void {
        const numHandle = Number(handle);
        if (!arr[idx]) arr[idx] = { prefix, handle: numHandle };
        else {
            arr[idx].prefix = prefix;
            arr[idx].handle = numHandle;
        }
    }

    /**
     * The voices process() renders, in output order: the active engine, with
     * stock open303 first while live A/B shadows the high-fid voice note for note.
     */
    private renderedVoices(): NativeVoiceRef[] {
        const out = this.rendered;
        let count = 0;
        const highFid = this.engineSelection.liveHighFid;
        const engine = this.engineSelection.activeEngine;
        if (engine === 'highfid' && highFid?.isReady) {
            if (this.engineSelection.abActive) this.updateRef(out, count++, 'open303', this.session.instanceHandle);
            this.updateRef(out, count++, 'highfid303', highFid.voiceHandle);
        } else if (engine === 'jc303' && this.session.hasJc303MultiApi) {
            this.updateRef(out, count++, 'jc303', this.session.jc303Handle);
        } else if (this.session.isNativeApi) {
            this.updateRef(out, count++, 'open303', this.session.instanceHandle);
        }
        out.length = count;
        return out;
    }

    private pushNote(type: number, note: number, velocity: number, audioTime: number | undefined): void {

        const frame = this.frameAt(audioTime);
        for (const voice of this.renderedVoices()) this.pushEvent(voice, frame, type, note, velocity);
    }

    private handleParam(func: string, value: number, audioTime: number | undefined): void {
        const paramId = JC303_PARAM_MAP[func];
        if (paramId !== undefined) this.routeParam(paramId, value, this.frameAt(audioTime));
    }

    /**
     * A param reaches every 303 voice this processor owns: the ones being
     * rendered on its frame, the idle ones now (they are not sounding). So an
     * engine switch, a CPU-gate step-down or A/B lands on a voice already in
     * sync — whatever order a switch message and the records around it arrive
     * in (#1497 P2: records and port messages travel separately).
     */
    private routeParam(paramId: number, value: number, frame: number): void {
        if (!this.session.isNativeApi) return;

        const targets = this.paramTargets;
        let count = 0;
        const highFid = this.engineSelection.liveHighFid;
        if (highFid?.isReady) this.updateRef(targets, count++, 'highfid303', highFid.voiceHandle);
        this.updateRef(targets, count++, 'open303', this.session.instanceHandle);
        if (this.session.hasJc303MultiApi) this.updateRef(targets, count++, 'jc303', this.session.jc303Handle);
        targets.length = count;

        const rendered = this.renderedVoices();
        for (let t = 0; t < targets.length; t++) {
            const target = targets[t];
            let sounding = false;
            for (let r = 0; r < rendered.length; r++) sounding ||= rendered[r].prefix === target.prefix;
            if (sounding) this.pushEvent(target, frame, VoiceEvent.Param, paramId, value);
            else this.setParamNow(target, paramId, value);
        }
    }

    /**
     * The route's records, at block start: each goes where its message would
     * have. Notes and a stop's CANCEL_NOTES / ALL_NOTES_OFF go to the voices
     * being rendered, in order, so the voice core drops exactly the notes
     * queued before the stop; params go to every voice (routeParam).
     */
    private routeEvents(): void {
        const f = this.record;
        while (this.nextEvent(f)) {
            const type = f[EventField.type];
            if (type === VoiceEvent.Param) {
                this.routeParam(f[EventField.target], f[EventField.value], f[EventField.frame]);
            } else if (
                type === VoiceEvent.NoteOn || type === VoiceEvent.NoteOff ||
                type === VoiceEvent.CancelNotes || type === VoiceEvent.AllNotesOff
            ) {
                const voices = this.renderedVoices();
                for (let i = 0; i < voices.length; i++) {
                    this.pushEvent(voices[i], f[0], type, f[2], f[3], f[4], f[5], f[6], f[7]);
                }
            }
        }
    }

    private setParamNow(voice: NativeVoiceRef, paramId: number, value: number): void {
        if (voice.prefix === 'highfid303') this.engineSelection.liveHighFid?.setParam(paramId, value);
        else if (voice.prefix === 'jc303') this.x.jc303_set_param(voice.handle, paramId, value);
        else this.x.open303_set_param(voice.handle, paramId, value);
    }

    /**
     * Stop / mute: cancel the notes still scheduled and release what sounds.
     * A release, not a reset — the 303 tail decays.
     */
    private releaseAllNotes(): void {
        for (const voice of this.renderedVoices()) {
            this.cancelNotes(voice);
            this.pushEvent(voice, 0, VoiceEvent.AllNotesOff, 0, 0);
        }
    }

    /**
     * Engine / model switch or CPU-gate step-down (called before the switch):
     * the voices about to go quiet drop their pending notes, apply their pending
     * params, and reset — nothing left to replay the next time they play.
     */
    private clearAllNotes(): void {
        if (!this.session.isInstantiated) return;
        for (const voice of this.renderedVoices()) this.quiesce(voice);
    }

    private quiesce(voice: NativeVoiceRef): void {
        try {
            this.cancelNotes(voice);
            this.flushEvents(voice);
            if (voice.prefix === 'highfid303') this.engineSelection.liveHighFid?.allNotesOff();
            else if (voice.prefix === 'jc303') this.x.jc303_all_notes_off(voice.handle);
            else this.x.open303_all_notes_off(voice.handle);
        } catch (e) {
            console.error('[Open303] clearAllNotes failed:', e);
        }
    }

    private handleLiveHighFidMessage(type: string, data: LiveHighFidMessageData | undefined): void {
        if (type === 'set-live-ab') {
            const wasShadowing = this.engineSelection.abActive;
            this.engineSelection.setLiveAb(data?.armed === true);
            // Side A stops rendering: don't leave its notes hanging for the next arm.
            if (wasShadowing && !this.engineSelection.abActive && this.session.isNativeApi) {
                const ref: NativeVoiceRef = { prefix: 'open303', handle: Number(this.session.instanceHandle) };
                this.quiesce(ref);
            }
        } else if (type === 'set-highfid-coeffs') {
            this.engineSelection.setHighFidCoefficients(data?.coefficients ?? null);
        } else {
            this.engineSelection.attachCoefficientTable(data?.buffer);
        }
    }

    // ── Render ───────────────────────────────────────────────────────────────

    process(_inputs: Float32Array[][], outputs: Float32Array[][], _parameters: Record<string, Float32Array>): boolean {
        if (this.disposed) return false;
        const output = outputs[0];
        if (!output) return true;

        const left = output[0];
        const right = output[1];
        const frames = left?.length ?? 128;
        this.beginBlock(frames);
        this.perf.beginProcess(frames);
        try {
            if (!this.session.isReady || !this.native) {
                NativeVoiceProcessor.silence(left, right);
            } else {
                this.routeEvents();
                this.renderBlock(outputs, frames, left, right);
            }
        } catch (e) {
            this.processFailed(e, left, right);
        } finally {
            this.perf.endProcess();
        }
        return true;
    }

    private renderBlock(
        outputs: Float32Array[][],
        frames: number,
        left: Float32Array | undefined,
        right: Float32Array | undefined,
    ): void {
        const gain = Open303Processor.OUTPUT_GAIN;
        const busB = outputs[1];
        const voices = this.renderedVoices();
        const highFid = voices.find((v) => v.prefix === 'highfid303');

        if (highFid) {
            // L3: pick up knob moves from the shared coefficient table.
            this.engineSelection.pollCoefficientTable();
            const quantumUs = (frames / this.rateHz) * 1_000_000;
            if (voices.length === 2 && busB) {
                // ── Live A/B (Phase L2): stock → output 0, high-fid → output 1 ──
                const tStock = getTime();
                this.renderVoice(voices[0], frames, left, right, gain);
                const stockUs = (getTime() - tStock) * 1000;
                const tHigh = getTime();
                this.renderVoice(highFid, frames, busB[0], busB[1], gain);
                const highUs = (getTime() - tHigh) * 1000;
                // Only the high-fid time feeds the gate — it can only trip side B.
                this.engineSelection.recordAbTiming(stockUs, highUs, quantumUs);
            } else {
                // A/B without a second bus: the stock side still drains its events.
                if (voices.length === 2) this.renderVoice(voices[0], frames, undefined, undefined);
                const t0 = getTime();
                this.renderVoice(highFid, frames, left, right, gain);
                // CPU meter / glitch gate — degrade to stock rather than glitch.
                this.engineSelection.recordHighFidTiming((getTime() - t0) * 1000, quantumUs);
            }
            return;
        }

        if (voices.length === 0) {
            NativeVoiceProcessor.silence(left, right);
            return;
        }
        this.renderVoice(voices[0], frames, left, right, gain);

        // A/B still armed but side B is gone (CPU gate): mirror stock onto bus B
        // until the main thread collapses the blend to side A, so a blend parked
        // at high-fid never drops to silence.
        if (busB && this.engineSelection.isAbArmed && !this.engineSelection.abActive) {
            if (busB[0] && left) busB[0].set(left);
            if (busB[1] && right) busB[1].set(right);
        }
    }
}

registerProcessor('open303-processor', Open303Processor);
