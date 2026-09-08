// src/audio-worklets/open303/engineSelection.ts
// Which DSP engine (open303 / jc303 / live high-fid) is currently active for a
// processor instance, and the model-registry + live high-fid lifecycle that
// decides it. Delegates all WASM instance/handle access to Open303EngineSession.

import {
    LIVE_HIGHFID_MODEL_ID,
    LiveHighFid303Voice,
    LiveHighFidGuard,
    clampLiveOversample,
    supportsLiveHighFid,
    type LiveHighFidOversample,
} from '../liveHighFid303';
import type { Open303EngineSession } from './engineSession';
import type { EngineFamily } from './shared';

export class Open303EngineSelection {
    private engine: EngineFamily = 'open303';
    private model: string = 'stock-open303';

    /** Live high-fid voice — created lazily, only when a track selects it. */
    private highFid: LiveHighFid303Voice | null = null;
    private readonly highFidGuard = new LiveHighFidGuard();
    private highFidOversample: LiveHighFidOversample = 1;
    /** Set once the CPU/glitch gate has stepped this processor down to stock. */
    private highFidDegraded = false;

    private readonly session: Open303EngineSession;
    private readonly port: MessagePort;
    private readonly clearAllNotes: () => void;

    constructor(
        session: Open303EngineSession,
        port: MessagePort,
        clearAllNotes: () => void,
    ) {
        this.session = session;
        this.port = port;
        this.clearAllNotes = clearAllNotes;
    }

    get activeEngine(): EngineFamily {
        return this.engine;
    }

    get activeModel(): string {
        return this.model;
    }

    get liveHighFid(): LiveHighFid303Voice | null {
        return this.highFid;
    }

    /** Switch the active DSP engine for this processor instance.
     *  Clears any held notes before switching to avoid stuck notes. */
    setEngine(engine: EngineFamily): void {
        if (engine === this.engine) return;

        if (engine === 'jc303' && !this.session.hasJc303MultiApi) {
            console.warn('[Open303] Authentic JC303 engine not available — ignoring set-engine request');
            return;
        }

        if (engine === 'highfid' && !this.ensureLiveHighFid()) {
            console.warn('[Open303] Live high-fid engine unavailable — ignoring set-engine request');
            return;
        }

        // Release any held notes on the current engine before switching
        this.clearAllNotes();

        this.engine = engine;
        console.log(`[Open303] Engine switched to: ${engine}`);
        this.port.postMessage({ type: 'engine-changed', data: { engine } });
    }

    /** Select the active 303 voice/model. Resolves the engine family from the
     *  native registry when available, otherwise trusts the fallbackEngine hint
     *  sent by Open303Oscillator (mirrored TS registry). */
    setModel(
        model: string,
        fallbackEngine?: EngineFamily,
        oversample?: number,
    ): void {
        const entry = this.session.modelRegistry?.get(model);
        const isLiveHighFid = model === LIVE_HIGHFID_MODEL_ID || fallbackEngine === 'highfid';
        const engine: EngineFamily = isLiveHighFid ? 'highfid' : entry?.engine ?? fallbackEngine ?? 'open303';

        if (engine === 'jc303' && !this.session.hasJc303MultiApi) {
            console.warn(`[Open303] Model "${model}" needs the JC303 engine which is unavailable — ignoring`);
            return;
        }

        if (engine === 'highfid') {
            if (oversample !== undefined) {
                this.highFidOversample = clampLiveOversample(oversample);
                this.highFid?.setOversample(this.highFidOversample);
            }
            // A previous CPU-gate step-down stays in force for the session:
            // re-arming it automatically would just glitch again.
            if (this.highFidDegraded) {
                console.warn('[Open303] Live high-fid stays disabled (CPU gate tripped this session)');
                this.reportLiveHighFidUnavailable(model, 'CPU gate tripped earlier this session');
                return;
            }
            if (!this.ensureLiveHighFid()) {
                this.reportLiveHighFidUnavailable(model, 'highfid303_* exports missing from this WASM build');
                return;
            }
        }

        const exports = this.session.getExports();

        // Apply the coefficient profile to the custom open303 instance.
        if (entry && engine === 'open303' && this.session.isNativeApi &&
            typeof exports.open303_set_model === 'function') {
            try {
                exports.open303_set_model(this.session.toWasmHandle(this.session.instanceHandle), entry.index);
            } catch (e) {
                console.warn(`[Open303] open303_set_model("${model}") failed:`, e);
            }
        }

        if (engine !== this.engine) {
            // Release any held notes on the current engine before switching
            this.clearAllNotes();
            this.engine = engine;
        }

        this.model = model;
        console.log(`[Open303] 303 model set to: ${model} (engine=${engine}, native=${entry !== undefined})`);
        this.port.postMessage({ type: 'model-changed', data: { model, engine } });
    }

    // ── Live high-fid (Phase L1) ─────────────────────────────────────────────

    /** Create the live diode-ladder voice on first use. Idempotent. */
    private ensureLiveHighFid(): boolean {
        if (this.highFid?.isReady) return true;
        if (this.highFidDegraded) return false;
        if (!this.session.isNativeApi || this.session.isInvalidHandle(this.session.nativeOutputPtr)) return false;

        const exports = this.session.getExports();
        if (!supportsLiveHighFid(exports)) {
            console.log('[Open303] Live high-fid engine not available in this WASM build');
            return false;
        }

        const voice = new LiveHighFid303Voice(exports, (h) => this.session.toWasmHandle(h));
        if (!voice.init(this.session.sampleRateHz, this.session.nativeBufFrames, this.highFidOversample)) {
            console.warn('[Open303] Live high-fid init failed');
            return false;
        }

        this.highFid = voice;
        this.highFidGuard.reset();
        console.log(`[Open303] Live high-fid voice ready (oversample=${voice.activeOversample}×)`);
        return true;
    }

    /** Tell the main thread the requested live high-fid voice cannot be used. */
    private reportLiveHighFidUnavailable(model: string, reason: string): void {
        this.port.postMessage({
            type: 'live-highfid-unavailable',
            data: { model, reason, fallbackModel: 'stock-open303' },
        });
    }

    /** Feed one block's high-fid render timing to the CPU/glitch gate, and
     *  degrade to stock if it trips. Called once per block from process(). */
    recordHighFidTiming(renderUs: number, quantumUs: number): void {
        const verdict = this.highFidGuard.record(renderUs, quantumUs);
        if (verdict.degrade && verdict.reason) {
            this.degradeLiveHighFid(verdict.reason, verdict.cpuPercent, verdict.underruns);
        }
    }

    /**
     * CPU/glitch gate tripped — step down to the stock voice for the rest of
     * the session and tell the main thread which path is now audible.
     */
    private degradeLiveHighFid(reason: string, cpuPercent: number, underruns: number): void {
        this.highFidDegraded = true;
        this.clearAllNotes();
        this.highFid?.destroy();
        this.highFid = null;
        this.engine = 'open303';
        this.model = 'stock-open303';
        // The custom open303 instance may still carry whatever coefficient
        // profile was selected before the high-fid voice — put it back on stock.
        const stockEntry = this.session.modelRegistry?.get('stock-open303');
        const exports = this.session.getExports();
        if (stockEntry && this.session.isNativeApi && typeof exports.open303_set_model === 'function') {
            try {
                exports.open303_set_model(this.session.toWasmHandle(this.session.instanceHandle), stockEntry.index);
            } catch (e) {
                console.warn('[Open303] Reverting to stock profile after high-fid degrade failed:', e);
            }
        }
        console.warn(`[Open303] Live high-fid degraded to stock: ${reason}`);
        this.port.postMessage({
            type: 'live-highfid-degraded',
            data: { reason, cpuPercent, underruns, fallbackModel: 'stock-open303' },
        });
        this.port.postMessage({
            type: 'model-changed',
            data: { model: 'stock-open303', engine: 'open303' },
        });
    }
}
