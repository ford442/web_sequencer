#!/usr/bin/env node
/**
 * Generates the built-in vowel pack for the concatenative hybrid (V2):
 * public/assets/vowels/manifest.json plus one looped WAV per vowel.
 *
 *   node scripts/generate-vowel-pack.mjs [--out public/assets/vowels]
 *
 * The voice is a formant synthesizer, not a recording: a glottal pulse train
 * through a cascade of second-order resonators (F1..F5). The pulse period is
 * a whole number of samples, so once the resonators settle the output repeats
 * exactly and the loop points sit on period boundaries with no seam. Rubber
 * Band pitch-shifts the loop to the sequenced note with formants preserved;
 * the pack only needs one pitch per vowel.
 *
 * Deterministic: re-running it writes byte-identical files. The WAVs carry a
 * `smpl` chunk with the same loop points as the manifest; the app reads the
 * manifest (decodeAudioData ignores `smpl`).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const SAMPLE_RATE = 48000;
/** Pulse period in samples: 48000 / 183 = 262.30 Hz, 4 cents above C4. */
const PERIOD = 183;
const DURATION_S = 0.75;
const ATTACK_S = 0.04;
const LOOP_START_S = 0.15;
const LOOP_END_S = 0.7;
const PEAK = 0.5;

/** F1..F3 (Hz) per vowel; F4/F5 are shared. Adult averages, rounded. */
const VOWELS = {
    ah: [730, 1090, 2440],
    ee: [270, 2290, 3010],
    eh: [530, 1840, 2480],
    oh: [570, 840, 2410],
    oo: [300, 870, 2240],
    ih: [390, 1990, 2550],
    uh: [640, 1190, 2390],
};
const UPPER_FORMANTS = [3500, 4500];
const BANDWIDTHS = [80, 90, 120, 180, 250];

function glottalPulse(n) {
    // Rosenberg pulse: 40 % opening, 16 % closing, closed for the rest.
    const open = Math.round(PERIOD * 0.4);
    const close = Math.round(PERIOD * 0.16);
    const k = n % PERIOD;
    if (k < open) return 0.5 * (1 - Math.cos((Math.PI * k) / open));
    if (k < open + close) return Math.cos((Math.PI * (k - open)) / (2 * close));
    return 0;
}

function resonator(freq, bandwidth) {
    const r = Math.exp((-Math.PI * bandwidth) / SAMPLE_RATE);
    const a1 = 2 * r * Math.cos((2 * Math.PI * freq) / SAMPLE_RATE);
    const a2 = -r * r;
    const gain = 1 - a1 - a2;
    let y1 = 0;
    let y2 = 0;
    return (x) => {
        const y = gain * x + a1 * y1 + a2 * y2;
        y2 = y1;
        y1 = y;
        return y;
    };
}

function synthesizeVowel(formants) {
    const length = Math.round(DURATION_S * SAMPLE_RATE);
    const stages = [...formants, ...UPPER_FORMANTS].map((f, i) => resonator(f, BANDWIDTHS[i]));
    const out = new Float64Array(length);
    let prev = 0;
    for (let n = 0; n < length; n++) {
        const flow = glottalPulse(n);
        let x = flow - prev; // lip radiation: first difference of the flow
        prev = flow;
        for (const stage of stages) x = stage(x);
        out[n] = x;
    }
    // Normalise on the steady state, then fade in. The fade ends long before
    // the loop starts, so the loop region stays exactly periodic.
    let peak = 0;
    for (let n = Math.round(LOOP_START_S * SAMPLE_RATE); n < length; n++) peak = Math.max(peak, Math.abs(out[n]));
    const attack = Math.round(ATTACK_S * SAMPLE_RATE);
    for (let n = 0; n < length; n++) {
        const env = n < attack ? 0.5 * (1 - Math.cos((Math.PI * n) / attack)) : 1;
        out[n] = (out[n] / peak) * PEAK * env;
    }
    return out;
}

function loopPoints() {
    const loopStart = Math.ceil((LOOP_START_S * SAMPLE_RATE) / PERIOD) * PERIOD;
    const periods = Math.floor((LOOP_END_S * SAMPLE_RATE - loopStart) / PERIOD);
    return { loopStart, loopEnd: loopStart + periods * PERIOD };
}

function encodeWav(samples, loopStart, loopEnd) {
    const dataBytes = samples.length * 2;
    const smplBytes = 36 + 24;
    const buffer = Buffer.alloc(12 + 24 + 8 + smplBytes + 8 + dataBytes);
    let o = 0;
    const str = (s) => { buffer.write(s, o, 'ascii'); o += s.length; };
    const u32 = (v) => { buffer.writeUInt32LE(v, o); o += 4; };
    const u16 = (v) => { buffer.writeUInt16LE(v, o); o += 2; };
    str('RIFF'); u32(buffer.length - 8); str('WAVE');
    str('fmt '); u32(16); u16(1); u16(1); u32(SAMPLE_RATE); u32(SAMPLE_RATE * 2); u16(2); u16(16);
    // smpl: one forward loop, end inclusive per the RIFF spec.
    str('smpl'); u32(smplBytes);
    u32(0); u32(0); u32(Math.round(1e9 / SAMPLE_RATE)); u32(60); u32(0); u32(0); u32(0); u32(1); u32(0);
    u32(0); u32(0); u32(loopStart); u32(loopEnd - 1); u32(0); u32(0);
    str('data'); u32(dataBytes);
    for (const s of samples) {
        buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s * 32767))), o);
        o += 2;
    }
    return buffer;
}

function main(argv) {
    const outIdx = argv.indexOf('--out');
    const outDir = resolve(ROOT, outIdx >= 0 ? argv[outIdx + 1] : 'public/assets/vowels');
    mkdirSync(outDir, { recursive: true });

    const f0Hz = SAMPLE_RATE / PERIOD;
    const midiNote = Number((69 + 12 * Math.log2(f0Hz / 440)).toFixed(4));
    const { loopStart, loopEnd } = loopPoints();
    const samples = [];
    for (const [vowel, formants] of Object.entries(VOWELS)) {
        const file = `${vowel}.wav`;
        const path = join(outDir, file);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, encodeWav(synthesizeVowel(formants), loopStart, loopEnd));
        samples.push({ vowel, file, midiNote, f0Hz: Number(f0Hz.toFixed(4)), loopStart, loopEnd });
    }
    const manifest = {
        version: 1,
        generator: 'scripts/generate-vowel-pack.mjs',
        sampleRate: SAMPLE_RATE,
        samples,
    };
    writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Wrote ${samples.length} vowels to ${outDir} (loop ${loopStart}..${loopEnd} @ ${SAMPLE_RATE} Hz)`);
}

main(process.argv.slice(2));
