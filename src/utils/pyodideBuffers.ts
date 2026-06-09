import type { WaveShape } from './waveformParser';

/** Map VoiceManager wave shapes to generate_wave() osc_type strings. */
export const PYODIDE_OSC_TYPE: Record<WaveShape, string> = {
  saw: 'saw',
  sqr: 'square',
  sin: 'sine',
  tri: 'sine',
};

export type PyodideLike = {
  globals: {
    get: (name: string) => (...args: unknown[]) => unknown;
  };
};

const REF_FREQ = 261.63;
const LOOP_DURATION_SEC = 2.0;
const DEFAULT_CUTOFF = 8000;
const DEFAULT_RESONANCE = 0.5;

function pyodideSamplesToFloat32(pyProxy: {
  toJs: (opts: { array_buffer_type: 'float32' }) => Float32Array;
  destroy: () => void;
}): Float32Array | null {
  try {
    const samples = pyProxy.toJs({ array_buffer_type: 'float32' });
    pyProxy.destroy();
    return samples?.length ? samples : null;
  } catch {
    try {
      pyProxy.destroy();
    } catch {
      /* noop */
    }
    return null;
  }
}

/** Synchronous one-shot buffer for a single note (used when pre-render cache misses). */
export function generatePyodideLoopBuffer(
  pyodide: PyodideLike,
  context: AudioContext,
  shape: WaveShape,
  filterCutoff = DEFAULT_CUTOFF,
  filterResonance = DEFAULT_RESONANCE,
): AudioBuffer | null {
  try {
    pyodide.globals.get('set_sample_rate')(context.sampleRate);
    const generate = pyodide.globals.get('generate_loop_buffer') ?? pyodide.globals.get('generate_wave');
    const pyProxy = generate(
      REF_FREQ,
      LOOP_DURATION_SEC,
      PYODIDE_OSC_TYPE[shape],
      Math.max(20, Math.min(context.sampleRate / 2.1, filterCutoff)),
      Math.max(0.1, filterResonance),
    ) as {
      toJs: (opts: { array_buffer_type: 'float32' }) => Float32Array;
      destroy: () => void;
    };
    const float = pyodideSamplesToFloat32(pyProxy);
    if (!float) return null;
    const buf = context.createBuffer(1, float.length, context.sampleRate);
    buf.getChannelData(0).set(float);
    return buf;
  } catch {
    return null;
  }
}

/** Pre-render C4 loop buffers for live VoiceManager playback. */
export async function prerenderPyodideBuffers(
  pyodide: PyodideLike,
  context: AudioContext,
): Promise<Partial<Record<WaveShape, AudioBuffer | null>>> {
  const shapes: WaveShape[] = ['saw', 'sqr', 'sin'];
  const out: Partial<Record<WaveShape, AudioBuffer | null>> = {};
  for (const shape of shapes) {
    out[shape] = generatePyodideLoopBuffer(pyodide, context, shape);
  }
  return out;
}

export const PYODIDE_REF_FREQ = REF_FREQ;
