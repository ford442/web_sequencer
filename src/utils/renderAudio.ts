// @mode: typescript
// @note-for-ai: Audio rendering utilities with hybrid engine support.
// Already uses WebGPU/WASM/Pyodide engines when available.
// The skipFilter logic prevents double-filtering when WASM/Pyodide handle it.
// See engines directory for the actual performance-critical implementations.

import type { SynthParams, KickParams, SnareParams, HatParams, DrumSound, DrumKitType } from '@/types';
import { getTunedFrequency, type ScaleDefinition } from '@/utils/musicTheory';
import type { PyodideLike } from '@/utils/pyodideBuffers';
import { resolveExportSampleRate } from '@/utils/audioContextPolicy';
import { createOfflineBuffer, createOfflineContext } from '@/audio/offline/createOfflineContext';
import { macroEngineForWaveform } from '@/engines/MacroParams';
import { renderMacroBuffer } from '@/audio/offline/OfflineMacroEngine';
import { renderDrumkitBuffer } from '@/audio/offline/OfflineDrumKitEngine';
import { renderRustOscOffline } from '@/audio/offline/OfflineRustOscEngine';
import { renderCppOscOffline } from '@/audio/offline/OfflineCppOscEngine';
import { renderDwgsOscOffline } from '@/audio/offline/OfflineDwgsOscEngine';
import { dwgsWaveIndex } from '@/engines/dwgsWaves';
import { parseWaveform } from '@/utils/waveformParser';
import { logWaveformSubstitution } from '@/utils/engineTelemetry';
import { DrumKitEngine } from '@/engines/DrumKitEngine';
import { instrumentStore } from '@/stores/instrumentStore';
import { noteToMidi } from '@/utils/musicTheory';
import { fetchPublicArrayBuffer } from '@/utils/publicAsset';

type PyodideResultProxy = {
    toJs: (opts: { array_buffer_type: 'float32' }) => Float32Array;
    destroy: () => void;
};

interface WebGpuEngineLike {
    isSupported: boolean;
    generate(
        freq: number,
        dur: number,
        rate: number,
        type: 'saw' | 'sqr' | 'tri' | 'sin',
    ): Float32Array | null | Promise<Float32Array | null>;
}

interface WasmEngineLike {
    isReady: boolean;
    generate(
        freq: number,
        dur: number,
        rate: number,
        type: 'saw' | 'sqr' | 'tri' | 'sin',
        cutoff: number,
        resonance: number,
    ): Float32Array | null;
}

interface RenderSynthEngines {
    webGpuEngine?: WebGpuEngineLike | null;
    wasmEngine?: WasmEngineLike | null;
    pyodide?: PyodideLike | null;
}

export type { RenderSynthEngines, WebGpuEngineLike, WasmEngineLike };

/** The offline rust-* substitution is reported once, not once per rendered hit. */
let rustOfflineSubstitutionReported = false;
/** Same for cpp-*. */
let cppOfflineSubstitutionReported = false;
/** Same for dwgs-*. */
let dwgsOfflineSubstitutionReported = false;

/**
 * Filter changes inside one rendered note (#1384): a 303 voice's automation
 * lands on every step, so a held note moves with it. `time` is seconds from
 * the note start; the value at time 0 is `params` itself.
 */
export type SynthFilterCurve = ReadonlyArray<{ time: number; filterCutoff?: number; filterResonance?: number }>;

/**
 * Renders a synth sound to an AudioBuffer.
 * Useful for exporting to XM samples.
 *
 * `sampleRate` defaults to whatever the user sample-rate policy resolves to
 * (#1233) rather than a hardcoded 44.1 kHz — a one-shot baked for XM should be
 * recorded at the rate the voice is auditioned at.
 */
export async function renderSynthToBuffer(
    params: SynthParams,
    note: string = 'C4',
    duration: number = 2.0,
    engines?: RenderSynthEngines,
    sampleRate: number = resolveExportSampleRate(),
    filterCurve?: SynthFilterCurve,
): Promise<AudioBuffer> {
    const midi = noteToMidi(note);
    const baseFreq = getTunedFrequency(note, '12-TET', 'C'); // default for offline rendering
    if (midi === null || baseFreq === null) throw new Error(`renderSynthToBuffer: "${note}" is not a note name`);

    // A macro model: one note through the live engine's wasm (mid channel, so
    // XM one-shots stay mono). The gate covers the note; the tail is whatever
    // fits in `duration`. Unavailable → the model's fallback waveform, below.
    const macroEngine = macroEngineForWaveform(params.waveform);
    if (macroEngine) {
        const rendered = await renderMacroBuffer({
            params,
            engine: macroEngine,
            notes: [{ midi, velocity: 0.8, startSeconds: 0, durationSeconds: duration * 0.8 }],
            durationSeconds: duration,
            sampleRate,
        }, 1);
        if (rendered) return rendered;
        params = { ...params, waveform: macroEngine.fallback };
    }

    const offlineCtx = createOfflineContext({ channels: 1, durationSeconds: duration, sampleRate });

    const time = 0;
    // Apply pitch shift from params
    const freqWithPitch = baseFreq * Math.pow(2, params.pitch / 12);

    let sourceNode: AudioScheduledSourceNode | null = null;
    let customBuffer: AudioBuffer | null = null;
    let skipFilter = false; // Engines like Wasm might apply filter internally

    // Check for Custom Engines first
    if (params.waveform.startsWith('wgsl-') && engines?.webGpuEngine?.isSupported) {
        // WebGPU
        try {
            const type = params.waveform.split('-')[1] as 'saw' | 'sqr' | 'tri' | 'sin';
            const rawData = await engines.webGpuEngine.generate(
                freqWithPitch,
                duration,
                sampleRate,
                type
            );
            if (rawData) {
                customBuffer = offlineCtx.createBuffer(1, rawData.length, sampleRate);
                customBuffer.getChannelData(0).set(rawData);
            }
        } catch(e) { console.error("WebGPU Export Error", e); }
    }
    else if (params.waveform.startsWith('rust-')) {
        // Rust OSC (#1664): the live voice's own kernel, rendered offline. No
        // filter in the kernel, so the biquad below applies — as in `Voice`.
        const { shape } = parseWaveform(params.waveform);
        try {
            const rawData = await renderRustOscOffline({
                shape,
                hz: freqWithPitch,
                frames: Math.ceil(duration * sampleRate),
                sampleRate,
            });
            if (rawData) {
                customBuffer = offlineCtx.createBuffer(1, rawData.length, sampleRate);
                customBuffer.getChannelData(0).set(rawData);
            } else if (!rustOfflineSubstitutionReported) {
                // Once per session: a bounce calls this per hit.
                rustOfflineSubstitutionReported = true;
                logWaveformSubstitution(
                    'oscillators',
                    'rust',
                    shape,
                    shape,
                    'rust_osc.wasm unavailable for the offline render; rendered on the JS oscillator',
                );
            }
        } catch (e) { console.error('Rust OSC Export Error', e); }
    }
    else if (params.waveform.startsWith('cpp-')) {
        // C++ OSC (#1665): the live voice's own kernel, rendered offline. No
        // filter in the kernel, so the biquad below applies — as in `Voice`.
        const { shape } = parseWaveform(params.waveform);
        try {
            const rawData = await renderCppOscOffline({
                shape,
                hz: freqWithPitch,
                frames: Math.ceil(duration * sampleRate),
                sampleRate,
            });
            if (rawData) {
                customBuffer = offlineCtx.createBuffer(1, rawData.length, sampleRate);
                customBuffer.getChannelData(0).set(rawData);
            } else if (!cppOfflineSubstitutionReported) {
                // Once per session: a bounce calls this per hit.
                cppOfflineSubstitutionReported = true;
                logWaveformSubstitution(
                    'oscillators',
                    'cpp',
                    shape,
                    shape,
                    'cpp_osc.wasm unavailable for the offline render; rendered on the JS oscillator',
                );
            }
        } catch (e) { console.error('C++ OSC Export Error', e); }
    }
    else if (params.waveform.startsWith('dwgs-')) {
        // DWGS (#1666): the live voice's own kernel, rendered offline. No
        // filter in the kernel, so the biquad below applies — as in `Voice`.
        const { shape, variant } = parseWaveform(params.waveform);
        try {
            const rawData = await renderDwgsOscOffline({
                wave: Math.max(0, dwgsWaveIndex(variant)),
                hz: freqWithPitch,
                frames: Math.ceil(duration * sampleRate),
                sampleRate,
            });
            if (rawData) {
                customBuffer = offlineCtx.createBuffer(1, rawData.length, sampleRate);
                customBuffer.getChannelData(0).set(rawData);
            } else if (!dwgsOfflineSubstitutionReported) {
                // Once per session: a bounce calls this per hit.
                dwgsOfflineSubstitutionReported = true;
                logWaveformSubstitution(
                    'oscillators',
                    'dwgs',
                    variant ?? shape,
                    shape,
                    'dwgs_osc.wasm unavailable for the offline render; rendered on the JS oscillator',
                );
            }
        } catch (e) { console.error('DWGS Export Error', e); }
    }
    else if (params.waveform.startsWith('wam-') && engines?.wasmEngine?.isReady) {
        // WASM
        try {
            const type = params.waveform.split('-')[1] as 'saw' | 'sqr' | 'tri' | 'sin';
            const rawData = engines.wasmEngine.generate(
                freqWithPitch,
                duration,
                sampleRate,
                type,
                params.filterCutoff,
                params.filterResonance
            );
            if (rawData) {
                customBuffer = offlineCtx.createBuffer(1, rawData.length, sampleRate);
                customBuffer.getChannelData(0).set(rawData);
                skipFilter = true; // WASM engine applies filter
            }
        } catch(e) { console.error("WASM Export Error", e); }
    }
    else if (params.waveform.startsWith('pyodide-') && engines?.pyodide) {
        // Pyodide
        try {
            engines.pyodide.globals.get('set_sample_rate')(sampleRate);
            const pyOscType = params.waveform.split('-')[1];
            const pyProxy = engines.pyodide.globals.get('generate_wave')(
                freqWithPitch,
                duration,
                pyOscType,
                params.filterCutoff,
                params.filterResonance
            ) as PyodideResultProxy;
            const audioSamples = pyProxy.toJs({ array_buffer_type: "float32" });
            pyProxy.destroy();

            if (audioSamples) {
                customBuffer = offlineCtx.createBuffer(1, audioSamples.length, sampleRate);
                customBuffer.getChannelData(0).set(audioSamples);
                skipFilter = true; // Pyodide engine applies filter
            }
        } catch(e) { console.error("Pyodide Export Error", e); }
    }

    if (customBuffer) {
        const bufferSource = offlineCtx.createBufferSource();
        bufferSource.buffer = customBuffer;
        sourceNode = bufferSource;
    }
    // Handle Sample-Based Waveforms
    else if (params.waveform === 'wav-saw' || params.waveform === 'wav-sqr') {
        const bufferSource = offlineCtx.createBufferSource();
        const url = params.waveform === 'wav-saw' ? 'saw.wav' : 'square.wav';
        const rootFreq = params.waveform === 'wav-saw' ? 32.86 : 65.72;

        try {
            const arrayBuffer = await fetchPublicArrayBuffer(url);
            const audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer);

            bufferSource.buffer = audioBuffer;
            bufferSource.loop = true;

            // Calculate playback rate
            const playbackRate = freqWithPitch / rootFreq;
            bufferSource.playbackRate.setValueAtTime(playbackRate, time);

            sourceNode = bufferSource;
        } catch (e) {
            console.error(`Failed to load wav buffer for ${params.waveform}`, e);
            // Fallback
            const osc = offlineCtx.createOscillator();
            osc.type = params.waveform === 'wav-saw' ? 'sawtooth' : 'square';
            osc.frequency.setValueAtTime(freqWithPitch, time);
            sourceNode = osc;
        }
    } else {
        // Standard Waveforms Fallback
        const osc = offlineCtx.createOscillator();
        let type: OscillatorType = 'sawtooth';
        if (params.waveform.includes('sqr')) type = 'square';
        else if (params.waveform.includes('tri')) type = 'triangle';
        else if (params.waveform.includes('sin')) type = 'sine';
        osc.type = type;
        osc.frequency.setValueAtTime(freqWithPitch, time);
        sourceNode = osc;
    }

    // Connect Graph
    // Source -> (Filter?) -> VCA -> Dest

    // Filter
    let nextNode: AudioNode = sourceNode;

    if (!skipFilter) {
        const filter = offlineCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(params.filterCutoff, time);
        filter.Q.setValueAtTime(params.filterResonance, time);
        for (const point of filterCurve ?? []) {
            if (point.time <= time || point.time >= duration) continue;
            if (point.filterCutoff !== undefined) filter.frequency.setValueAtTime(point.filterCutoff, point.time);
            if (point.filterResonance !== undefined) filter.Q.setValueAtTime(point.filterResonance, point.time);
        }
        sourceNode.connect(filter);
        nextNode = filter;
    }

    // VCA (Envelope)
    const gain = offlineCtx.createGain();
    const attack = params.attack;
    const decay = params.decay;
    const sustain = params.sustain;
    const release = params.release;

    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(1.0, time + attack); // Normalize to 1.0 for sample
    gain.gain.linearRampToValueAtTime(sustain, time + attack + decay);
    // Hold sustain. A note shorter than its release starts releasing at once:
    // `duration - release` would be negative, which setValueAtTime rejects.
    gain.gain.setValueAtTime(sustain, Math.max(time, duration - release));
    gain.gain.linearRampToValueAtTime(0, duration);

    nextNode.connect(gain);
    gain.connect(offlineCtx.destination);

    sourceNode.start(time);
    // For buffer sources we don't strictly need stop if buffer matches duration, but safe practice
    if (sourceNode instanceof OscillatorNode) {
        sourceNode.stop(time + duration);
    } else if (customBuffer) {
        // Stop is implied by buffer length usually, but just in case
    }

    return await offlineCtx.startRendering();
}

/** How long one hit's buffer runs: the voice's own tail, with a floor per sound. */
function drumHitDuration(sound: DrumSound, params: KickParams | SnareParams | HatParams): number {
    const floor = sound === 'closedHat' || sound === 'openHat' ? 0.3 : 0.5;
    return params.decay ? Math.max(floor, params.decay * (sound === 'snare' ? 1.5 : 1.2)) : floor;
}

export interface RenderDrumOptions {
    /** The kit the hit sounds in; defaults to the one the user is sequencing. */
    kit?: DrumKitType;
    /**
     * An explicit Python render: the Pyodide `generate_kick` / `generate_snare` /
     * `generate_hat` table generators instead of the live kit. Never the default —
     * the bounce is the kit the user sequenced unless the caller asks for this.
     */
    python?: PyodideLike | null;
}

/**
 * Renders a drum sound to an AudioBuffer (mono).
 *
 * The same kit the live engine plays: the `drumkit_*` voice in hyphon_native,
 * rendered offline with the live trigger arguments. If that wasm is not
 * available the live engine's own Web Audio fallback kit renders instead
 * (DrumKitEngine.play), so the sound degrades the way live playback does.
 * Python is only used when `options.python` asks for it.
 */
export async function renderDrumToBuffer(
    sound: DrumSound,
    params: KickParams | SnareParams | HatParams,
    sampleRate: number = resolveExportSampleRate(),
    options: RenderDrumOptions = {},
): Promise<AudioBuffer> {
    const duration = drumHitDuration(sound, params);

    if (options.python) {
        const buffer = renderDrumWithPython(options.python, sound, params, sampleRate);
        if (buffer) return buffer;
        // A failed explicit Python render drops to the live kit, below.
    }

    const kit = options.kit ?? instrumentStore.drumKitRef.current;
    const native = await renderDrumkitBuffer(
        {
            kit,
            hits: [{ sound, params, startSeconds: 0 }],
            durationSeconds: duration,
            sampleRate,
        },
        1,
    );
    if (native) return native;

    return renderDrumFallbackKit(sound, params, kit, duration, sampleRate);
}

/** Explicit Python render of one hit; null when the generator is missing or fails. */
function renderDrumWithPython(
    pyodide: PyodideLike,
    sound: DrumSound,
    params: KickParams | SnareParams | HatParams,
    sampleRate: number,
): AudioBuffer | null {
    try {
        let pyProxy: PyodideResultProxy;
        if (sound === 'kick') {
            const p = params as KickParams;
            pyProxy = pyodide.globals.get('generate_kick')(p.pitch, p.decay, p.tone, p.volume) as PyodideResultProxy;
        } else if (sound === 'snare') {
            const p = params as SnareParams;
            pyProxy = pyodide.globals.get('generate_snare')(p.decay, p.tone, p.noise, p.volume) as PyodideResultProxy;
        } else {
            const p = params as HatParams;
            pyProxy = pyodide.globals.get('generate_hat')(p.pitch, p.decay, p.volume) as PyodideResultProxy;
        }

        const audioSamples = pyProxy.toJs({ array_buffer_type: 'float32' });
        pyProxy.destroy();

        if (audioSamples && audioSamples.length > 0) {
            const buffer = createOfflineBuffer({ channels: 1, length: audioSamples.length, sampleRate });
            buffer.getChannelData(0).set(audioSamples);
            return buffer;
        }
    } catch (e) {
        console.error(`Pyodide drum render error (${sound}):`, e);
    }
    return null;
}

/**
 * The live engine's own fallback kit (DrumKitEngine without its worklet) on an
 * offline context: what a hit sounds like live when the native module is down.
 */
async function renderDrumFallbackKit(
    sound: DrumSound,
    params: KickParams | SnareParams | HatParams,
    kit: DrumKitType,
    duration: number,
    sampleRate: number,
): Promise<AudioBuffer> {
    const offlineCtx = createOfflineContext({ channels: 1, durationSeconds: duration, sampleRate });
    const out = offlineCtx.createGain();
    out.connect(offlineCtx.destination);

    const noise = offlineCtx.createBuffer(1, Math.ceil(sampleRate * duration), sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // DrumKitEngine is typed on the live context; the fallback path only uses
    // the node factories an offline context shares with it.
    new DrumKitEngine(kit).play(offlineCtx as unknown as AudioContext, out, noise, sound, params, 0);
    return offlineCtx.startRendering();
}
