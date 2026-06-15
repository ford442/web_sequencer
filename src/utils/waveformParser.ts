import type { Waveform } from '../types';

export type OscEngineId = 'js' | 'wav' | 'wasm' | 'wgsl' | 'rust' | 'pyodide' | 'wam' | '303' | 'cpp';
export type WaveShape = 'saw' | 'sqr' | 'tri' | 'sin';

const ENGINE_MAP: Record<string, OscEngineId> = {
    wav: 'wav',
    pyodide: 'pyodide',
    wgsl: 'wgsl',
    wam: 'wam',
    rust: 'rust',
    '303': '303',
    cpp: 'cpp',
};

const SHAPE_ALIASES: Record<string, WaveShape> = {
    saw: 'saw',
    sawtooth: 'saw',
    sqr: 'sqr',
    square: 'sqr',
    tri: 'tri',
    triangle: 'tri',
    sin: 'sin',
    sine: 'sin',
};

export function parseWaveform(w: Waveform): { engine: OscEngineId; shape: WaveShape } {
    if (w === 'sawtooth' || w === 'square' || w === 'triangle' || w === 'sine') {
        return { engine: 'js', shape: SHAPE_ALIASES[w] };
    }
    const dash = w.indexOf('-');
    if (dash > 0) {
        const prefix = w.slice(0, dash);
        const suffix = w.slice(dash + 1);
        const engine = ENGINE_MAP[prefix] ?? 'js';
        // cpp-rand is a distinct waveform; map to saw for legacy shape consumers until CppOscillator lands.
        if (suffix === 'rand') {
            return { engine, shape: 'saw' };
        }
        const shape = SHAPE_ALIASES[suffix] ?? 'saw';
        return { engine, shape };
    }
    return { engine: 'js', shape: 'saw' };
}

export const shapeToOscillatorType = (s: WaveShape): OscillatorType =>
    s === 'saw' ? 'sawtooth' : s === 'sqr' ? 'square' : s === 'tri' ? 'triangle' : 'sine';
