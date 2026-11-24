#!/usr/bin/env node
/**
 * Measure the WebGPU filter (#1675) on a real WebGPU adapter.
 *
 *   node tools/measure_gpu_filter.mjs            # human-readable
 *   node tools/measure_gpu_filter.mjs --json     # machine-readable
 *
 * Bundles the shipped `WebGpuOscillator` (the real WGSL, the real uniform
 * layout, the real readback) for the browser, runs it in headless Chromium and
 * reports:
 *
 *   exactness  the kernel against its f64 mirror (`gpuFilter.ts`), per response
 *   vs native  a GPU-filtered note against the same note through a real
 *              `BiquadFilterNode` in an `OfflineAudioContext` (steady state)
 *   bank       all 116 per-note tables of a filtered bank against the mirror
 *   timing     one dispatch + readback for each thing the app asks the GPU for
 *
 * Needs `playwright` (a dev dependency) and a Chromium with WebGPU. Headless
 * Linux has no GPU, so it runs on Chromium's SwiftShader adapter, a CPU
 * emulation — the timings are an upper bound for real hardware, where the
 * single readback dominates. Set CHROMIUM_PATH to use a specific binary.
 * The exit code is 1 when any accuracy gate fails.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
const json = process.argv.includes('--json');

/** Accuracy gates, in dB re the table's peak (lower is better). The f32 kernel is held to these. */
export const GATES = {
    /** Kernel vs its f64 mirror. */
    mirrorDb: -60,
    /** GPU-filtered note vs the same note through a real BiquadFilterNode. */
    nativeDb: -60,
};

async function bundle() {
    const { build } = await import(pathToFileURL(require.resolve('vite')).href);
    const dir = mkdtempSync(join(tmpdir(), 'gpu-filter-'));
    const entry = join(dir, 'entry.ts');
    const src = (p) => JSON.stringify(join(root, 'src', p));
    writeFileSync(
        entry,
        [
            `import { WebGpuOscillator } from ${src('engines/WebGpuOscillator')};`,
            `import * as gf from ${src('engines/backends/gpuFilter')};`,
            `import * as wb from ${src('engines/backends/wavetableBands')};`,
            `(window as unknown as { GpuBench: unknown }).GpuBench = { WebGpuOscillator, gf, wb };`,
        ].join('\n'),
    );
    try {
        const out = await build({
            root,
            configFile: false,
            logLevel: 'error',
            // Library mode leaves `process.env.NODE_ENV` for the consumer; the page has no `process`.
            define: { 'process.env.NODE_ENV': '"production"' },
            build: {
                write: false,
                minify: false,
                lib: { entry, formats: ['iife'], name: 'GpuBenchBundle', fileName: 'bench' },
            },
        });
        const outputs = Array.isArray(out) ? out.flatMap((o) => o.output) : out.output;
        const chunk = outputs.find((o) => o.type === 'chunk');
        if (!chunk) throw new Error('vite produced no chunk');
        return chunk.code;
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

/** Runs inside the page. Must not close over anything. */
async function measureInPage(gates) {
    const { WebGpuOscillator, gf, wb } = window.GpuBench;
    const SR = 48000;
    const L = wb.WAVETABLE_LENGTH;
    const db = (x) => 20 * Math.log10(Math.max(x, 1e-12));
    const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const report = { adapter: null, exactness: [], vsNative: [], bank: null, timing: {}, failures: [] };
    const fail = (msg) => report.failures.push(msg);

    const adapter = await navigator.gpu.requestAdapter();
    report.adapter = adapter?.info ? `${adapter.info.vendor}/${adapter.info.architecture}` : 'unknown';

    const engine = new WebGpuOscillator();
    await engine.init();
    if (!engine.isSupported) {
        report.failures.push('WebGpuOscillator.init() did not produce a device');
        return report;
    }

    const errDb = (got, want) => {
        let peak = 0;
        let err = 0;
        for (let i = 0; i < want.length; i++) {
            peak = Math.max(peak, Math.abs(want[i]));
            err = Math.max(err, Math.abs(got[i] - want[i]));
        }
        return { errDb: db(err / Math.max(peak, 1e-9)), peak };
    };

    // ── exactness: kernel vs f64 mirror ─────────────────────────────────────
    const exact = [];
    for (const shape of ['saw', 'sqr', 'tri', 'sin']) {
        for (const f of [55, 220, 1046.5, 4186]) {
            exact.push({ shape, f, spec: null });
            for (const [type, fc, q] of [['lp', 800, 6], ['bp', 1600, 8], ['hp', 400, 2], ['lp', 20, 0.707], ['lp', 18000, 30]]) {
                exact.push({ shape, f, spec: { type, cutoff: fc, q } });
            }
        }
    }
    for (const c of exact) {
        const length = 4096;
        const got = await engine.generate(c.f, length / SR, SR, c.shape, c.spec);
        const inc = wb.phaseIncrementFor(c.f, SR);
        const want = gf.referenceWaveform({
            shape: c.shape,
            cyclesPerSample: inc / 2 ** 32,
            maxHarmonic: wb.maxHarmonicFor(c.f, SR),
            f0: c.f,
            sampleRate: SR,
            spec: c.spec,
            length,
        });
        const { errDb: e, peak } = errDb(got, want);
        const label = `${c.shape} ${c.f}Hz ${c.spec ? `${c.spec.type} fc=${c.spec.cutoff} Q=${c.spec.q}` : 'unfiltered'}`;
        report.exactness.push({ label, errDb: +e.toFixed(1), peak: +peak.toFixed(3) });
        if (!(e < gates.mirrorDb) && peak > 1e-4) fail(`mirror: ${label} is ${e.toFixed(1)} dB (gate ${gates.mirrorDb})`);
    }

    // ── vs a real BiquadFilterNode, steady state ────────────────────────────
    // A periodic note through the native filter, then through the GPU filter, same note.
    const nativeCases = [
        { shape: 'saw', cycles: 17, type: 'lp', fc: 1500, knob: 6 },
        { shape: 'saw', cycles: 17, type: 'lp', fc: 300, knob: 18 },
        { shape: 'saw', cycles: 9, type: 'bp', fc: 900, knob: 5 },
        { shape: 'sqr', cycles: 9, type: 'hp', fc: 2400, knob: 4 },
        { shape: 'tri', cycles: 33, type: 'lp', fc: 4000, knob: 0 },
        { shape: 'saw', cycles: 5, type: 'lp', fc: 60, knob: 3 },
    ];
    for (const c of nativeCases) {
        const f = (c.cycles * SR) / L;
        // The note is periodic with a whole number of cycles per table, so one exact period
        // from the kernel is the whole signal; the native filter is fed enough of them to settle.
        const periods = c.fc < 100 ? 600 : 80;
        const N = periods * L;
        const spec = gf.gpuFilterSpec(c.type, c.fc, c.knob, SR);
        const dry = (await engine.generate(f, L / SR, SR, c.shape)).subarray(0, L);
        const wet = (await engine.generate(f, L / SR, SR, c.shape, spec)).subarray(0, L);
        const ctx = new OfflineAudioContext(1, N, SR);
        const buf = ctx.createBuffer(1, N, SR);
        for (let p = 0; p < periods; p++) buf.getChannelData(0).set(dry, p * L);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const biquad = ctx.createBiquadFilter();
        biquad.type = c.type === 'bp' ? 'bandpass' : c.type === 'hp' ? 'highpass' : 'lowpass';
        biquad.frequency.value = c.fc;
        biquad.Q.value = c.knob; // dB for lp/hp, linear for bp: what the voice sets
        src.connect(biquad).connect(ctx.destination);
        src.start();
        const native = (await ctx.startRendering()).getChannelData(0);
        const { errDb: e, peak } = errDb(wet, native.subarray(N - L));
        const label = `${c.shape} ${c.type} fc=${c.fc} Q=${c.knob}${c.type === 'bp' ? '' : ' dB'} @${f.toFixed(1)}Hz`;
        report.vsNative.push({ label, errDb: +e.toFixed(1), peak: +peak.toFixed(3) });
        if (!(peak > 0.01)) fail(`native: ${label} rendered silence`);
        else if (!(e < gates.nativeDb)) fail(`native: ${label} is ${e.toFixed(1)} dB (gate ${gates.nativeDb})`);
    }

    // ── a whole bank vs the mirror ──────────────────────────────────────────
    {
        const spec = gf.quantizeGpuFilter(gf.gpuFilterSpec('lp', 1800, 8, SR), SR).spec;
        const set = await engine.renderFilteredBank(SR, 'saw', spec);
        if (!set) {
            fail('renderFilteredBank returned null');
        } else {
            let worst = -Infinity;
            let worstNote = 0;
            let finite = true;
            let mirrorMs = 0;
            for (let i = 0; i < set.notes.length; i++) {
                const note = set.notes[i];
                const band = set.bands[note.band];
                if (!set.tables[i].every(Number.isFinite)) finite = false;
                const tm = performance.now();
                const want = gf.referenceWaveform({
                    shape: 'saw',
                    cyclesPerSample: band.cycles / L,
                    maxHarmonic: band.maxHarmonic,
                    f0: note.f0,
                    sampleRate: SR,
                    spec,
                    length: L,
                });
                mirrorMs += performance.now() - tm;
                const { errDb: e, peak } = errDb(set.tables[i], want);
                if (peak > 1e-4 && e > worst) {
                    worst = e;
                    worstNote = note.midi;
                }
            }
            report.bank = {
                notes: set.notes.length,
                filter: spec,
                worstDb: +worst.toFixed(1),
                worstNote,
                finite,
                renderMs: +set.renderMs.toFixed(1),
                // The same bank from a plain f64 JS loop (`referenceWaveform`): a CPU baseline, not a tuned one.
                cpuMirrorMs: Math.round(mirrorMs),
            };
            if (!finite) fail('bank has non-finite samples');
            if (!(worst < gates.mirrorDb)) fail(`bank: note ${worstNote} is ${worst.toFixed(1)} dB (gate ${gates.mirrorDb})`);
        }
    }

    // ── timing: one dispatch + readback each ────────────────────────────────
    const time = async (fn, runs = 7) => {
        await fn(); // warm: pipeline compile, buffer pool
        const ms = [];
        for (let i = 0; i < runs; i++) {
            const t0 = performance.now();
            await fn();
            ms.push(performance.now() - t0);
        }
        return { median: +median(ms).toFixed(1), min: +Math.min(...ms).toFixed(1) };
    };
    const spec = gf.gpuFilterSpec('lp', 1800, 8, SR);
    report.timing.wavetableSet36 = await time(() => engine.renderWavetables(SR));
    report.timing.bank116 = await time(() => engine.renderFilteredBank(SR, 'saw', spec));
    report.timing.bank116Sqr = await time(() => engine.renderFilteredBank(SR, 'sqr', spec));
    report.timing.note1sUnfiltered440 = await time(() => engine.generate(440, 1, SR, 'saw'));
    report.timing.note1sFiltered440 = await time(() => engine.generate(440, 1, SR, 'saw', spec));
    report.timing.note1sFiltered55 = await time(() => engine.generate(55, 1, SR, 'saw', spec));
    report.timing.note4sFiltered55 = await time(() => engine.generate(55, 4, SR, 'saw', spec));
    return report;
}

function print(report) {
    const rows = (title, list) => {
        console.log(`\n${title}`);
        for (const r of list) console.log(`  ${String(r.errDb).padStart(7)} dB  (peak ${r.peak})  ${r.label}`);
    };
    console.log(`WebGPU adapter: ${report.adapter}`);
    const worst = (list) => list.reduce((m, r) => (r.peak > 1e-4 ? Math.max(m, r.errDb) : m), -Infinity);
    console.log(`\nexactness vs f64 mirror: ${report.exactness.length} cases, worst ${worst(report.exactness)} dB (gate ${GATES.mirrorDb})`);
    rows('vs a real BiquadFilterNode (steady state, dB re peak)', report.vsNative);
    if (report.bank) {
        console.log(`\nbank: ${report.bank.notes} notes, worst ${report.bank.worstDb} dB at MIDI ${report.bank.worstNote}, finite=${report.bank.finite}`);
        console.log(`      the same bank from a plain f64 JS loop: ${report.bank.cpuMirrorMs} ms`);
    }
    console.log('\ntiming (ms, one dispatch + readback; median / min of 7):');
    for (const [k, v] of Object.entries(report.timing)) console.log(`  ${k.padEnd(24)} ${String(v.median).padStart(7)} / ${v.min}`);
    console.log(report.failures.length ? `\nFAILED:\n  ${report.failures.join('\n  ')}` : '\nall gates passed');
}

async function main() {
    const code = await bundle();
    const { chromium } = require('@playwright/test');
    const browser = await chromium.launch({
        executablePath: process.env.CHROMIUM_PATH || undefined,
        args: [
            '--enable-unsafe-webgpu',
            '--use-webgpu-adapter=swiftshader',
            '--use-angle=swiftshader',
            '--ignore-gpu-blocklist',
            '--no-sandbox',
        ],
    });
    try {
        const page = await browser.newPage();
        // WebGPU needs a secure context; localhost is one.
        await page.route('http://localhost/**', (r) =>
            r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
        await page.goto('http://localhost/');
        page.on('pageerror', (e) => console.error('[page]', e.message));
        await page.addScriptTag({ content: code });
        const report = await page.evaluate(measureInPage, GATES);
        if (json) console.log(JSON.stringify(report, null, 2));
        else print(report);
        process.exitCode = report.failures.length ? 1 : 0;
    } finally {
        await browser.close();
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    await main();
}
