// Tests for Voice.startNote engine-routing and fallback behaviour.
// Every specialised engine path must be taken when the engine is available,
// and must emit a console.warn + fall back to a JS OscillatorNode when it isn't.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Voice, type VoiceEngineDeps } from '../VoiceManager';
import type { SynthParams } from '../../types';

// ── Minimal SynthParams fixture ──────────────────────────────────────────────

const BASE_PARAMS: SynthParams = {
    length: 1,
    waveform: 'sawtooth',
    pitch: 0,
    filterCutoff: 2000,
    filterResonance: 1,
    attack: 0.01,
    decay: 0.1,
    sustain: 0.7,
    release: 0.3,
    volume: 0.8,
    delayTime: 0,
    delayFeedback: 0,
    delayMix: 0,
};

// ── Web Audio mock helpers ───────────────────────────────────────────────────
// We construct a fresh mock AudioContext per test so spy counts stay isolated.

function makeBufferSourceMock() {
    return {
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        disconnect: vi.fn(),
        buffer: null as AudioBuffer | null,
        loop: false,
        playbackRate: { value: 1, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    };
}

function makeOscillatorMock() {
    return {
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        disconnect: vi.fn(),
        type: 'sawtooth' as OscillatorType,
        frequency: { value: 0, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    };
}

function makeAudioBuffer(length = 1024): AudioBuffer {
    return {
        length,
        numberOfChannels: 1,
        sampleRate: 44100,
        getChannelData: vi.fn(() => new Float32Array(length)),
        copyFromChannel: vi.fn(),
        copyToChannel: vi.fn(),
        duration: length / 44100,
    } as unknown as AudioBuffer;
}

function makeContext(oscMock = makeOscillatorMock(), bufSrcMock = makeBufferSourceMock()) {
    const context = {
        sampleRate: 44100,
        currentTime: 0,
        createOscillator: vi.fn(() => oscMock),
        createBufferSource: vi.fn(() => bufSrcMock),
        createBiquadFilter: vi.fn(() => ({
            connect: vi.fn(),
            frequency: { value: 0, setValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() },
            Q: { value: 0, setValueAtTime: vi.fn() },
            type: 'lowpass',
        })),
        createGain: vi.fn(() => ({
            connect: vi.fn(),
            gain: { value: 0, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        })),
        createDelay: vi.fn(() => ({
            connect: vi.fn(),
            delayTime: { value: 0 },
        })),
        createStereoPanner: vi.fn(() => ({
            connect: vi.fn(),
            pan: { value: 0, setValueAtTime: vi.fn() },
        })),
        createBuffer: vi.fn((ch: number, len: number, sr: number) => makeAudioBuffer(len)),
    } as unknown as AudioContext;
    return context;
}

function makeDestination() {
    return { connect: vi.fn() } as unknown as AudioNode;
}

// ── Construct a Voice with given deps ────────────────────────────────────────

function makeVoice(
    deps: VoiceEngineDeps = {},
    wavSaw?: AudioBuffer,
    wavSqr?: AudioBuffer,
    ctx?: AudioContext,
) {
    const context = ctx ?? makeContext();
    return new Voice(context, makeDestination(), wavSaw, wavSqr, undefined, deps);
}

// ── WAV tests ────────────────────────────────────────────────────────────────

describe('Voice.startNote — WAV engine', () => {
    it('uses AudioBufferSourceNode when the saw buffer is loaded', () => {
        const buf = makeAudioBuffer();
        const bufSrc = makeBufferSourceMock();
        const ctx = makeContext(makeOscillatorMock(), bufSrc);
        const voice = makeVoice({}, buf, undefined, ctx);

        voice.startNote({ ...BASE_PARAMS, waveform: 'wav-saw' }, 'C4', 0);

        expect(ctx.createBufferSource).toHaveBeenCalled();
        expect(ctx.createOscillator).not.toHaveBeenCalled();
    });

    it('warns and falls back to JS oscillator when saw buffer is null', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const oscMock = makeOscillatorMock();
        const ctx = makeContext(oscMock);
        const voice = makeVoice({}, undefined, undefined, ctx); // no wav buffers

        voice.startNote({ ...BASE_PARAMS, waveform: 'wav-saw' }, 'C4', 0);

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('wav-saw'));
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('falling back'));
        expect(ctx.createOscillator).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('warns and falls back when sqr buffer is null', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const ctx = makeContext();
        const voice = makeVoice({}, undefined, undefined, ctx);

        voice.startNote({ ...BASE_PARAMS, waveform: 'wav-sqr' }, 'C4', 0);

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('wav-sqr'));
        warn.mockRestore();
    });
});

// ── WAM / WasmOscillator tests ───────────────────────────────────────────────

describe('Voice.startNote — WAM engine', () => {
    it('uses WasmOscillator.generate() when ready', () => {
        const float = new Float32Array(512).fill(0.1);
        const wasmEngine = { isReady: true, generate: vi.fn(() => float) };
        const bufSrc = makeBufferSourceMock();
        const ctx = makeContext(makeOscillatorMock(), bufSrc);
        const voice = makeVoice({ wasmEngine: wasmEngine as any }, undefined, undefined, ctx);

        voice.startNote({ ...BASE_PARAMS, waveform: 'wam-saw' }, 'C4', 0);

        expect(wasmEngine.generate).toHaveBeenCalledWith(
            261.63, 2.0, 44100, 'saw', expect.any(Number), expect.any(Number),
        );
        expect(ctx.createBufferSource).toHaveBeenCalled();
        expect(ctx.createOscillator).not.toHaveBeenCalled();
    });

    it('warns and falls back when WasmOscillator is not ready', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const wasmEngine = { isReady: false, generate: vi.fn() };
        const oscMock = makeOscillatorMock();
        const ctx = makeContext(oscMock);
        const voice = makeVoice({ wasmEngine: wasmEngine as any }, undefined, undefined, ctx);

        voice.startNote({ ...BASE_PARAMS, waveform: 'wam-sqr' }, 'C4', 0);

        expect(wasmEngine.generate).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('wam-sqr'));
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('not ready'));
        expect(ctx.createOscillator).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('warns and falls back when generate() returns empty', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const wasmEngine = { isReady: true, generate: vi.fn(() => new Float32Array(0)) };
        const ctx = makeContext();
        const voice = makeVoice({ wasmEngine: wasmEngine as any }, undefined, undefined, ctx);

        voice.startNote({ ...BASE_PARAMS, waveform: 'wam-saw' }, 'C4', 0);

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('wam-saw'));
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('returned empty'));
        expect(ctx.createOscillator).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('warns and falls back when no wasmEngine in deps', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const ctx = makeContext();
        const voice = makeVoice({}, undefined, undefined, ctx);

        voice.startNote({ ...BASE_PARAMS, waveform: 'wam-saw' }, 'C4', 0);

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('wam-saw'));
        warn.mockRestore();
    });
});

// ── Rust tests ───────────────────────────────────────────────────────────────

describe('Voice.startNote — Rust engine', () => {
    it('uses RustOscillator.generate() when ready', () => {
        const float = new Float32Array(512).fill(0.2);
        const rustEngine = { isReady: true, generate: vi.fn(() => float) };
        const bufSrc = makeBufferSourceMock();
        const ctx = makeContext(makeOscillatorMock(), bufSrc);
        const voice = makeVoice({ rustEngine: rustEngine as any }, undefined, undefined, ctx);

        voice.startNote({ ...BASE_PARAMS, waveform: 'rust-saw' }, 'C4', 0);

        expect(rustEngine.generate).toHaveBeenCalledWith(
            261.63, 2.0, 44100, 'saw', expect.any(Number), expect.any(Number),
        );
        expect(ctx.createBufferSource).toHaveBeenCalled();
        expect(ctx.createOscillator).not.toHaveBeenCalled();
    });

    it('warns and falls back when RustOscillator is not ready', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const rustEngine = { isReady: false, generate: vi.fn() };
        const ctx = makeContext();
        const voice = makeVoice({ rustEngine: rustEngine as any }, undefined, undefined, ctx);

        voice.startNote({ ...BASE_PARAMS, waveform: 'rust-sqr' }, 'C4', 0);

        expect(rustEngine.generate).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('rust-sqr'));
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('not ready'));
        expect(ctx.createOscillator).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('warns and falls back when no rustEngine in deps', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const ctx = makeContext();
        const voice = makeVoice({}, undefined, undefined, ctx);

        voice.startNote({ ...BASE_PARAMS, waveform: 'rust-saw' }, 'C4', 0);

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('rust-saw'));
        warn.mockRestore();
    });

    it('warns and falls back when generate() returns empty', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const rustEngine = { isReady: true, generate: vi.fn(() => new Float32Array(0)) };
        const ctx = makeContext();
        const voice = makeVoice({ rustEngine: rustEngine as any }, undefined, undefined, ctx);

        voice.startNote({ ...BASE_PARAMS, waveform: 'rust-sqr' }, 'C4', 0);

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('rust-sqr'));
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('returned empty'));
        warn.mockRestore();
    });
});

// ── WGSL / WebGPU tests ──────────────────────────────────────────────────────

describe('Voice.startNote — WGSL engine', () => {
    it('uses the pre-rendered buffer when available', () => {
        const gpuBuf = makeAudioBuffer();
        const bufSrc = makeBufferSourceMock();
        const ctx = makeContext(makeOscillatorMock(), bufSrc);
        const voice = makeVoice({ wgslBuffers: { saw: gpuBuf } }, undefined, undefined, ctx);

        voice.startNote({ ...BASE_PARAMS, waveform: 'wgsl-saw' }, 'C4', 0);

        expect(ctx.createBufferSource).toHaveBeenCalled();
        expect(ctx.createOscillator).not.toHaveBeenCalled();
    });

    it('warns and falls back when the buffer is missing (GPU unavailable)', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const ctx = makeContext();
        const voice = makeVoice({ wgslBuffers: {} }, undefined, undefined, ctx);

        voice.startNote({ ...BASE_PARAMS, waveform: 'wgsl-saw' }, 'C4', 0);

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('wgsl-saw'));
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('WebGPU buffer unavailable'));
        expect(ctx.createOscillator).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('falls back to the correct JS wave shape (sqr)', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const oscMock = makeOscillatorMock();
        const ctx = makeContext(oscMock);
        const voice = makeVoice({ wgslBuffers: {} }, undefined, undefined, ctx);

        voice.startNote({ ...BASE_PARAMS, waveform: 'wgsl-sqr' }, 'C4', 0);

        expect(oscMock.type).toBe('square');
        warn.mockRestore();
    });
});

// ── Pyodide tests ────────────────────────────────────────────────────────────

describe('Voice.startNote — Pyodide engine', () => {
    it('warns that live playback is unsupported and falls back to JS', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const oscMock = makeOscillatorMock();
        const ctx = makeContext(oscMock);
        const voice = makeVoice({ pyodideEngine: {} }, undefined, undefined, ctx);

        voice.startNote({ ...BASE_PARAMS, waveform: 'pyodide-saw' }, 'C4', 0);

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('pyodide-saw'));
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('async API'));
        expect(ctx.createOscillator).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('falls back to the correct JS wave shape (sine)', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const oscMock = makeOscillatorMock();
        const ctx = makeContext(oscMock);
        const voice = makeVoice({}, undefined, undefined, ctx);

        voice.startNote({ ...BASE_PARAMS, waveform: 'pyodide-sine' }, 'C4', 0);

        expect(oscMock.type).toBe('sine');
        warn.mockRestore();
    });
});

// ── JS / native oscillator path ──────────────────────────────────────────────

describe('Voice.startNote — JS native oscillator', () => {
    it('uses createOscillator for sawtooth without warnings', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const oscMock = makeOscillatorMock();
        const ctx = makeContext(oscMock);
        const voice = makeVoice({}, undefined, undefined, ctx);

        voice.startNote({ ...BASE_PARAMS, waveform: 'sawtooth' }, 'C4', 0);

        expect(ctx.createOscillator).toHaveBeenCalled();
        expect(oscMock.type).toBe('sawtooth');
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    it('maps waveform shapes correctly (square, triangle, sine)', () => {
        const shapes: Array<[import('../../types').Waveform, OscillatorType]> = [
            ['square', 'square'],
            ['triangle', 'triangle'],
            ['sine', 'sine'],
        ];
        for (const [waveform, expected] of shapes) {
            const oscMock = makeOscillatorMock();
            const ctx = makeContext(oscMock);
            const voice = makeVoice({}, undefined, undefined, ctx);
            voice.startNote({ ...BASE_PARAMS, waveform }, 'C4', 0);
            expect(oscMock.type).toBe(expected);
        }
    });
});
