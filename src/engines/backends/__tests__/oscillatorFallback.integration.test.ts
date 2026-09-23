/**
 * Integration coverage for the oscillator fallback path (#1034).
 *
 * Uses the real adapters and the real registry — only the concrete engines are
 * stubbed, because WebGPU/WASM cannot run under jsdom. It proves the whole
 * chain end to end: engines fail to init → registry drops down the preference
 * order → the fallback is logged, recorded in telemetry, and raised in the
 * degradation store that feeds the HUD and banner.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BackendRegistry, OSCILLATOR_SUBSYSTEM } from '../BackendRegistry';
import {
    JsOscillatorBackend,
    PyodideBackend,
    WamWasmBackend,
    WavPcmBackend,
    WebGpuBackend,
} from '../adapters';
import type { WebGpuOscillator } from '../../WebGpuOscillator';
import type { WasmOscillator } from '../../WasmOscillator';
import type { PyodideLike } from '../../../utils/pyodideBuffers';
import { engineTelemetry } from '../../../utils/engineTelemetry';
import { engineDegradationStore } from '../../../stores/engineDegradationStore';
import type { GenerateRequest } from '../OscillatorBackend';

function stubGpu(supported: boolean): WebGpuOscillator {
    const engine = {
        isSupported: false,
        init: vi.fn(async () => {
            engine.isSupported = supported;
        }),
        generate: vi.fn(async () => new Float32Array([0.5, -0.5, 0.5, -0.5])),
        destroy: vi.fn(),
    };
    return engine as unknown as WebGpuOscillator;
}

function stubWasm(ready: boolean): WasmOscillator {
    const engine = {
        isReady: false,
        init: vi.fn(async () => {
            engine.isReady = ready;
        }),
        generate: vi.fn(() => new Float32Array([0.25, -0.25, 0.25, -0.25])),
    };
    return engine as unknown as WasmOscillator;
}

/** A Pyodide runtime whose `generate_loop_buffer` returns a short saw. */
function stubPyodide(): PyodideLike {
    return {
        globals: {
            get: (name: string) =>
                name === 'set_sample_rate'
                    ? () => undefined
                    : () => ({
                          toJs: () => new Float32Array([0.1, -0.1, 0.1, -0.1]),
                          destroy: () => undefined,
                      }),
        },
    } as unknown as PyodideLike;
}

/** Mirrors how engineLifecycle assembles the chain. */
/** A BaseAudioContext stub good enough for the GPU pre-render and PCM tables. */
function makeCtx(): AudioContext {
    return {
        sampleRate: 44100,
        createBuffer: (channels: number, length: number, sampleRate: number) => {
            const data = new Float32Array(length);
            return {
                length,
                numberOfChannels: channels,
                sampleRate,
                getChannelData: () => data,
            } as unknown as AudioBuffer;
        },
    } as unknown as AudioContext;
}

/** Mirrors how engineLifecycle assembles the chain. */
async function buildChain(opts: {
    gpu: boolean;
    wam: boolean;
    pyodide?: boolean;
    wavBuffer?: AudioBuffer | null;
}) {
    const registry = new BackendRegistry();
    const ctx = makeCtx();
    const gpuBackend = new WebGpuBackend(stubGpu(opts.gpu));
    const wamBackend = new WamWasmBackend(stubWasm(opts.wam));
    const pyodideBackend = new PyodideBackend(opts.pyodide ? stubPyodide() : null);
    const wavBackend = new WavPcmBackend({ saw: opts.wavBuffer ?? null });

    registry.register(gpuBackend);
    registry.register(wamBackend);
    registry.register(pyodideBackend);
    registry.register(wavBackend);
    registry.register(new JsOscillatorBackend());

    await registry.initAll(ctx);
    return { registry, ctx, gpuBackend, wamBackend, pyodideBackend, wavBackend };
}

const REQ: GenerateRequest = {
    frequency: 220,
    duration: 0.02,
    sampleRate: 44100,
    shape: 'saw',
    cutoff: 6000,
    resonance: 1.2,
};

describe('oscillator backend fallback (integration)', () => {
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        engineDegradationStore.clear('oscillator-backend');
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    it('selects WebGPU when the GPU device initializes', async () => {
        const { registry } = await buildChain({ gpu: true, wam: true });
        const resolution = registry.resolveAndPublish();

        expect(resolution.active).toBe('webgpu');
        expect(resolution.degraded).toBe(false);
        expect(engineDegradationStore.getIssue('oscillator-backend')?.status).not.toBe('active');
    });

    it('falls back GPU → AS WASM when only the GPU is unavailable, and says so', async () => {
        const { registry } = await buildChain({ gpu: false, wam: true });
        const resolution = registry.resolveAndPublish();

        expect(resolution.active).toBe('wam');
        expect(resolution.degraded).toBe(true);
        expect(resolution.reason).toContain('webgpu');

        const issue = engineDegradationStore.getIssue('oscillator-backend');
        expect(issue?.status).toBe('active');
        expect(issue?.activeBackend).toBe('wam');
        expect(issue?.message).toContain('WASM OSC');
    });

    it('walks the full chain to the JS oscillator when every engine fails', async () => {
        const { registry } = await buildChain({ gpu: false, wam: false });
        const resolution = registry.resolveAndPublish();

        expect(resolution.active).toBe('js');
        expect(resolution.attempts.map((a) => a.id)).toEqual(['webgpu', 'wam', 'pyodide', 'wav', 'js']);
        for (const id of ['webgpu', 'wam', 'pyodide', 'wav']) {
            expect(resolution.attempts.find((a) => a.id === id)?.reason).toBeTruthy();
        }

        // Logged …
        expect(warn.mock.calls.some(([m]) => String(m).includes('fell back'))).toBe(true);
        // … recorded in telemetry …
        const snapshot = engineTelemetry.snapshot();
        expect(snapshot[OSCILLATOR_SUBSYSTEM]?.resolution?.backend).toBe('js');
        // … and shown to the user via the degradation store (HUD + banner source).
        expect(engineDegradationStore.getIssue('oscillator-backend')?.activeBackend).toBe('js');
    });

    it('still produces audible samples of the right wave family on the fallback path', async () => {
        const { registry } = await buildChain({ gpu: false, wam: false });
        const out = await registry.generate(REQ);

        expect(out).not.toBeNull();
        expect(out!.backendId).toBe('js');
        expect(out!.samples.length).toBe(Math.ceil(REQ.sampleRate * REQ.duration));
        // A saw ramps monotonically inside a cycle and spans roughly [-1, 1].
        expect(Math.max(...out!.samples)).toBeGreaterThan(0.9);
        expect(Math.min(...out!.samples)).toBeLessThan(-0.9);
    });

    it('skips the PCM backend for shapes it has no asset for, rather than substituting', async () => {
        const table = {
            length: 4,
            numberOfChannels: 1,
            sampleRate: 44100,
            getChannelData: () => new Float32Array([1, -1, 1, -1]),
        } as unknown as AudioBuffer;
        const { registry, wavBackend } = await buildChain({ gpu: false, wam: false, wavBuffer: table });

        expect(registry.resolve('saw').active).toBe('wav');

        const tri = registry.resolve('tri');
        expect(tri.active).toBe('js');
        expect(tri.reason).toContain('wav: does not render "tri" natively');
        expect(await wavBackend.generate({ ...REQ, shape: 'tri' })).toBeNull();
    });

    /**
     * The realtime entry point (#1294): a family enters the chain at its own
     * backend and can only ever fall *down*.
     */
    it('renders a wav-* note from the PCM backend without touching the GPU', async () => {
        const table = {
            length: 4,
            numberOfChannels: 1,
            sampleRate: 44100,
            getChannelData: () => new Float32Array([1, -1, 1, -1]),
        } as unknown as AudioBuffer;
        const { registry, ctx, gpuBackend } = await buildChain({
            gpu: true,
            wam: true,
            wavBuffer: table,
        });

        const render = registry.renderLoopFrom('wav', ctx, REQ);
        expect(render?.buffer).toBe(table);
        expect(gpuBackend.renderLoop(ctx, REQ)).not.toBeNull(); // GPU was usable …
        expect(registry.getLastResolution()?.active).not.toBe('webgpu'); // … but unused.
    });

    it('keeps voices audible when the session WebGPU probe fails', async () => {
        const { probeWebGPU, resetWebGpuProbeForTests, getLastWebGpuProbe } = await import('../webgpuProbe');
        resetWebGpuProbeForTests();
        vi.stubGlobal('navigator', { gpu: undefined });
        const probe = await probeWebGPU();
        expect(probe.ok).toBe(false);

        const { registry } = await buildChain({ gpu: false, wam: true });
        const out = await registry.generate(REQ);

        expect(getLastWebGpuProbe()?.ok).toBe(false);
        expect(out).not.toBeNull();
        expect(out!.backendId).toBe('wam');
        expect(out!.samples.length).toBeGreaterThan(0);
        vi.unstubAllGlobals();
    });
});
