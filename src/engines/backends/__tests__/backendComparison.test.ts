import { describe, it, expect } from 'vitest';
import {
    COMPARISON_BANDS,
    compareBackends,
    compareRenders,
    measureRender,
} from '../backendComparison';
import { JsOscillatorBackend, RustWasmBackend, WavPcmBackend } from '../adapters';
import type { RustOscillator } from '../../RustOscillator';
import type { GenerateRequest } from '../OscillatorBackend';

const SR = 44100;
const REQ: GenerateRequest = {
    frequency: 220,
    duration: 0.2,
    sampleRate: SR,
    shape: 'saw',
    cutoff: 20000,
    resonance: 1,
};

function render(shape: 'saw' | 'sqr' | 'tri' | 'sin', gain = 1, n = 8192): Float32Array {
    const out = new Float32Array(n);
    const inc = REQ.frequency / SR;
    let phase = 0;
    for (let i = 0; i < n; i++) {
        const p = phase;
        out[i] =
            gain *
            (shape === 'saw'
                ? 2 * p - 1
                : shape === 'sqr'
                  ? p < 0.5
                      ? 1
                      : -1
                  : shape === 'tri'
                    ? 2 * Math.abs(2 * p - 1) - 1
                    : Math.sin(2 * Math.PI * p));
        phase += inc;
        if (phase >= 1) phase -= 1;
    }
    return out;
}

/** A Rust engine stub that returns a real saw, so the harness has two backends. */
function stubRustEngine(shape: 'saw' | 'sqr'): RustOscillator {
    const engine = {
        isReady: true,
        init: async () => {},
        generate: () => render(shape),
    };
    return engine as unknown as RustOscillator;
}

describe('measureRender', () => {
    it('reports level and per-band energy', () => {
        const metrics = measureRender('js', render('saw'), SR);
        expect(metrics.backendId).toBe('js');
        expect(metrics.rms).toBeGreaterThan(0);
        expect(metrics.peak).toBeGreaterThan(0.9);
        for (const band of COMPARISON_BANDS) {
            expect(Number.isFinite(metrics.bands[band.name])).toBe(true);
        }
    });
});

describe('compareRenders', () => {
    it('passes for identical renders', () => {
        const a = render('saw');
        const cmp = compareRenders({ backendId: 'js', samples: a }, { backendId: 'rust', samples: a.slice() }, SR);
        expect(cmp.rmsErrorDb).toBeLessThan(0.01);
        expect(cmp.worstBandErrorDb).toBeLessThan(0.01);
        expect(cmp.withinTolerance).toBe(true);
    });

    it('level-matches, so a merely quieter backend is not flagged', () => {
        const cmp = compareRenders(
            { backendId: 'js', samples: render('saw', 1) },
            { backendId: 'rust', samples: render('saw', 0.25) },
            SR,
        );
        expect(cmp.withinTolerance).toBe(true);
    });

    it('flags a backend that silently changed wave family', () => {
        const cmp = compareRenders(
            { backendId: 'js', samples: render('sin') },
            { backendId: 'rust', samples: render('saw') },
            SR,
        );
        expect(cmp.worstBandErrorDb).toBeGreaterThan(6);
        expect(cmp.withinTolerance).toBe(false);
    });

    it('flags silence from a backend that claimed to be ready', () => {
        const cmp = compareRenders(
            { backendId: 'js', samples: render('saw') },
            { backendId: 'rust', samples: new Float32Array(8192) },
            SR,
        );
        expect(cmp.withinTolerance).toBe(false);
    });
});

describe('compareBackends', () => {
    it('renders through each backend and compares against the first', async () => {
        const js = new JsOscillatorBackend();
        const rust = new RustWasmBackend(stubRustEngine('saw'));
        await js.init();
        await rust.init();

        const report = await compareBackends([js, rust], REQ);
        expect(report.metrics.map((m) => m.backendId).sort()).toEqual(['js', 'rust']);
        expect(report.comparisons).toHaveLength(1);
        expect(report.comparisons[0].withinTolerance).toBe(true);
        expect(report.unavailable).toHaveLength(0);
    });

    it('lists backends that cannot service the request instead of dropping them', async () => {
        const js = new JsOscillatorBackend();
        const rust = new RustWasmBackend(stubRustEngine('saw'));
        const wav = new WavPcmBackend();
        await js.init();
        await rust.init();
        await wav.init();

        const report = await compareBackends([js, rust, wav], { ...REQ, shape: 'tri' });
        expect(report.unavailable.map((u) => u.backendId).sort()).toEqual(['rust', 'wav']);
        expect(report.unavailable.find((u) => u.backendId === 'rust')?.reason).toContain('tri');
        expect(report.metrics.map((m) => m.backendId)).toEqual(['js']);
    });

    it('detects a backend that drifted to the wrong wave family', async () => {
        const js = new JsOscillatorBackend();
        // Rust engine wired to a square while the request asks for a saw.
        const rust = new RustWasmBackend(stubRustEngine('sqr'));
        await js.init();
        await rust.init();

        const report = await compareBackends([js, rust], REQ);
        expect(report.comparisons[0].withinTolerance).toBe(false);
    });
});
