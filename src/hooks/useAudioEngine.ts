import { type AlignmentResult } from '../engines/rubberband/PhonemeAligner';
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { AudioEngine, SynthParams, DrumSound, KickParams, SnareParams, HatParams, SamplerBankParams, PartSequence } from '../types';
import { noteToFrequency } from '../constants';
import { noteToMidi } from '../utils/musicTheory';
import { WebGpuOscillator } from '../engines/WebGpuOscillator';
import { WasmOscillator } from '../engines/WasmOscillator';
import { Open303Oscillator } from '../engines/Open303Oscillator';
import { SingingVoice } from '../engines/SingingVoice';
import sustainProcessorUrl from '../audio-worklets/sustain-processor.ts?worker&url';
// Import the new processor URL (we will create this file next)
import open303ProcessorUrl from '../audio-worklets/open303-processor.ts?worker&url';

// Helper for distortion
const distortionCurveCache = new Map<number, Float32Array<ArrayBuffer>>();
function makeDistortionCurve(amount: number): Float32Array<ArrayBuffer> {
    const k_raw = typeof amount === 'number' ? amount : 50;
    const k = Math.round(k_raw * 10) / 10;
    if (distortionCurveCache.has(k)) return distortionCurveCache.get(k)!;
    const n_samples = 8192, curve = new Float32Array(n_samples), deg = Math.PI / 180;
    for (let i = 0; i < n_samples; ++i) {
        const x = (i * 2) / n_samples - 1;
        curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    distortionCurveCache.set(k, curve);
    return curve;
}


// Map UI params to Engine params
function apply303Params(engine: Open303Oscillator, params: SynthParams, waveType: string): void {
    engine.setWaveform(waveType === 'sqr' ? 1.0 : 0.0);
    // UI Cutoff (0-20000) -> Engine (0-1)
    engine.setCutoff(Math.max(0, Math.min(1, params.filterCutoff / 8000)));
    // UI Res (0-20) -> Engine (0-1)
    engine.setResonance(Math.max(0, Math.min(1, params.filter