// @mode: typescript
// The `wgsl-*` additive kernel's WGSL, as a pure function of its table budget.
// `WebGpuOscillator` owns the device, pipelines and buffers; this file owns what runs on them,
// so the shader can be read, scanned and bundled without a GPU (the reserved-word test in
// `WebGpuOscillator.test.ts`, and `tools/measure_gpu_filter.mjs`, which runs it on a real adapter).

/**
 * Additive, band-limited kernel (#1668), with the filter folded into the
 * harmonics (#1675). One invocation writes one sample of one table:
 * `global_id.x` is the sample, `global_id.y` the table. A whole table set
 * (every shape × every octave band) is one dispatch and one readback; an
 * offline `generate` is the same kernel with one table.
 *
 * Unfiltered renders (`filterType == 3`) run `main` alone, with each series
 * in closed form: one dispatch, nothing read but the uniforms — exactly what
 * the kernel did before the filter existed (bit-identical output, same time).
 *
 * A filtered render runs two passes in one submit, sharing the one storage
 * buffer (the shared device allows two storage buffers per stage, and the
 * coefficients sit in the buffer's tail, after the audio):
 *
 *   coeffs  one thread per (table, harmonic). The series gives the
 *           harmonic's amplitude and the filter its response at the
 *           harmonic's *audible* frequency h·f0: |H|·a and arg H, stored as
 *           a gain and a phase offset in cycles.
 *   main    one thread per (sample, table): Σ gain_h · sin(h·phase + offset_h).
 *
 * So filtering costs one pass over harmonics (not samples) plus a coefficient
 * read per harmonic in the synthesis loop.
 *
 * Phase is 32-bit fixed point: `index * phaseInc` and the per-harmonic
 * accumulation wrap modulo 2^32, which is exactly "mod one cycle". Nothing
 * is accumulated in f32, so there is no drift over a long render, and a
 * table whose increment is `cycles * 2^32 / length` returns to phase 0 at
 * sample `length` — the loop has no seam.
 *
 * Series (each matches the naive shape it replaces, sign and level):
 *   saw  2p-1            = -(2/π) Σ sin(2πhp)/h       all h ≤ H
 *   sqr  +1 then -1      =  (4/π) Σ sin(2πhp)/h       odd h ≤ H
 *   tri  2|2p-1|-1       = (8/π²) Σ cos(2πhp)/h²      odd h ≤ H
 *   sin                  =  sin(2πp)                  H ≥ 1
 * `H = 0` is silence: the pitch has no harmonic under Nyquist.
 *
 * The response is the RBJ biquad's, as the analog prototype at
 * s = jΩ, Ω = tan(ω/2)/tan(ω0/2) (the bilinear identity — no cancellation
 * near DC, unlike evaluating 1 + a1 z⁻¹ + a2 z⁻² in f32). `gpuFilter.ts`
 * is its f64 mirror.
 */
export function oscillatorShader(maxTables: number): string {
    return `
const MAX_TABLES: u32 = ${maxTables}u;

struct Params {
    numSamples: u32,
    tableCount: u32,
    // 0 lowpass, 1 bandpass, 2 highpass, 3 none.
    filterType: u32,
    // Harmonics reserved per table in the coefficient region.
    coefStride: u32,
    // x: tan(w0 / 2) of the cutoff, y: 1 / Q.
    resp: vec4<f32>,
    // Word offset of the coefficient region in audioBuffer (numSamples * tableCount).
    coefBase: u32,
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
    // x: phase increment (2^32 = one cycle), y: highest harmonic,
    // z: shape (0 saw, 1 sqr, 2 tri, 3 sin), w: output offset in samples.
    tables: array<vec4<u32>, MAX_TABLES>,
    // x: audible fundamental / sample rate (cycles per sample), yzw unused.
    freqs: array<vec4<f32>, MAX_TABLES>,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> audioBuffer: array<f32>;

const PI: f32 = 3.14159265358979;
const TAU: f32 = 6.28318530717959;
// 2π / 2^32: fixed-point phase → radians.
const PHASE_TO_RAD: f32 = 1.4629180792671596e-9;
// The largest f32 below 1: a phase offset of "almost a cycle" that still fits a u32.
const BELOW_ONE: f32 = 0.99999994;

fn rad(p: u32) -> f32 {
    return f32(p) * PHASE_TO_RAD;
}

@compute @workgroup_size(64)
fn coeffs(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let h = global_id.x + 1u;
    let table = global_id.y;
    if (table >= params.tableCount || h > params.coefStride) {
        return;
    }

    let t = params.tables[table];
    var gain: f32 = 0.0;
    var cycles: f32 = 0.0;

    if (h <= t.y) {
        let fh = f32(h);
        let odd = (h & 1u) == 1u;
        var amp: f32 = 0.0;
        var cosine = false;
        switch (t.z) {
            case 0u: { amp = -2.0 / (PI * fh); }
            case 1u: { if (odd) { amp = 4.0 / (PI * fh); } }
            case 2u: {
                if (odd) { amp = 8.0 / (PI * PI * fh * fh); }
                cosine = true;
            }
            default: { if (h == 1u) { amp = 1.0; } }
        }

        if (amp != 0.0) {
            var mag: f32 = 1.0;
            var phi: f32 = 0.0;
            var audible = true;
            if (params.filterType < 3u) {
                // Cycles per sample of this harmonic as it sounds; at Nyquist
                // tan(π/2) is infinite, and a harmonic there is dropped.
                let x = fh * params.freqs[table].x;
                if (x < 0.4999) {
                    let w = tan(PI * x) / params.resp.x;
                    let dr = 1.0 - w * w;
                    let di = w * params.resp.y;
                    let den = max(dr * dr + di * di, 1e-30);
                    var hr: f32;
                    var hi: f32;
                    switch (params.filterType) {
                        case 1u: {
                            hr = (di * di) / den;
                            hi = (di * dr) / den;
                        }
                        case 2u: {
                            let w2 = w * w;
                            hr = (-w2 * dr) / den;
                            hi = (w2 * di) / den;
                        }
                        default: {
                            hr = dr / den;
                            hi = -di / den;
                        }
                    }
                    mag = sqrt(hr * hr + hi * hi);
                    phi = atan2(hi, hr);
                } else {
                    audible = false;
                }
            }
            if (audible) {
                gain = amp * mag;
                // a|H| cos(θ + φ) = a|H| sin(θ + φ + π/2)
                if (cosine) { phi = phi + 0.5 * PI; }
                cycles = min(fract(phi / TAU), BELOW_ONE);
            }
        }
    }

    let slot = params.coefBase + 2u * (table * params.coefStride + (h - 1u));
    audioBuffer[slot] = gain;
    audioBuffer[slot + 1u] = cycles;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let index = global_id.x;
    let table = global_id.y;
    if (index >= params.numSamples || table >= params.tableCount) {
        return;
    }

    let t = params.tables[table];
    let inc = t.x;
    let harmonics = t.y;
    let shape = t.z;
    // Wraps modulo 2^32 — that is the phase, in cycles, exactly.
    let p1 = index * inc;

    var sum: f32 = 0.0;
    if (params.filterType == 3u) {
        // Unfiltered: the series in closed form, nothing read but the uniforms.
        switch (shape) {
            case 0u: {
                var ph = p1;
                for (var h = 1u; h <= harmonics; h = h + 1u) {
                    sum = sum + sin(rad(ph)) / f32(h);
                    ph = ph + p1;
                }
                sum = sum * (-2.0 / PI);
            }
            case 1u: {
                var ph = p1;
                let step = p1 * 2u;
                for (var h = 1u; h <= harmonics; h = h + 2u) {
                    sum = sum + sin(rad(ph)) / f32(h);
                    ph = ph + step;
                }
                sum = sum * (4.0 / PI);
            }
            case 2u: {
                var ph = p1;
                let step = p1 * 2u;
                for (var h = 1u; h <= harmonics; h = h + 2u) {
                    let fh = f32(h);
                    sum = sum + cos(rad(ph)) / (fh * fh);
                    ph = ph + step;
                }
                sum = sum * (8.0 / (PI * PI));
            }
            default: {
                if (harmonics >= 1u) {
                    sum = sin(rad(p1));
                }
            }
        }
    } else {
        // Filtered: each harmonic's gain and phase came from the coefficient pass.
        // Square and triangle have odd harmonics only; the sine has one.
        var hstep = 1u;
        var last = harmonics;
        switch (shape) {
            case 1u, 2u: { hstep = 2u; }
            case 3u: { last = min(harmonics, 1u); }
            default: {}
        }
        let pstep = p1 * hstep;
        let base = params.coefBase + 2u * (table * params.coefStride);

        var ph = p1;
        for (var h = 1u; h <= last; h = h + hstep) {
            let s = base + 2u * (h - 1u);
            let offset = u32(audioBuffer[s + 1u] * 4294967296.0);
            sum = sum + audioBuffer[s] * sin(rad(ph + offset));
            ph = ph + pstep;
        }
    }

    audioBuffer[t.w + index] = sum;
}
    `;
}
