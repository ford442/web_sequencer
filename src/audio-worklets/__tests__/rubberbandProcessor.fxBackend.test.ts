import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { RB_FX_ABI_VERSION, RB_FX_PARAM_COUNT, RB_FX_REQUIRED_EXPORTS } from '../rubberband/nativeVocalFx';
import { RUBBERBAND_PARAMETER_DESCRIPTORS } from '../rubberband/parameterDescriptors';
import { SpatialRouter } from '../rubberband/spatialRouter';
import { PhonemeDelay } from '../rubberband/phonemeDelay';
import { BassEnvelopeFollower } from '../rubberband/bassEnvelopeFollower';
import { DrumDuckEnvelope } from '../rubberband/drumDuckEnvelope';
import { BASS_TRIGGER_STRIDE, DRUM_TRIGGER_STRIDE, createSidechainRing } from '../../utils/sidechainTriggerRing';

type Posted = Record<string, unknown>;
type ProcessorInstance = {
  port: { postMessage: ReturnType<typeof vi.fn>; onmessage: ((e: MessageEvent) => unknown) | null };
  handleMessage(event: { data: Record<string, unknown> }): Promise<void>;
};

let nextModule: Record<string, unknown> = {};

vi.mock('../rubberband-lib.js', () => ({
  default: vi.fn(() => Promise.resolve(nextModule)),
}));

class FakeStretcher {
  reset() {}
  setPitchScale() {}
  setTimeRatio() {}
  getTimeRatio() { return 1; }
  getPitchScale() { return 1; }
  getSamplesRequired() { return 0; }
  process() {}
  available() { return 0; }
  retrieve() { return 0; }
}

function stretcherOnlyModule(): Record<string, unknown> {
  return { RubberBandStretcher: FakeStretcher, HEAPF32: new Float32Array(1024), _malloc: () => 0, _free() {} };
}

function fxModule(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const memory = new ArrayBuffer(1 << 20);
  const module: Record<string, unknown> = {
    ...stretcherOnlyModule(),
    HEAPF32: new Float32Array(memory),
    HEAPF64: new Float64Array(memory),
  };
  for (const name of RB_FX_REQUIRED_EXPORTS) module[name] = () => 0;
  return Object.assign(module, {
    _rb_fx_abi_version: () => RB_FX_ABI_VERSION,
    _rb_fx_param_count: () => RB_FX_PARAM_COUNT,
    _rb_fx_create: () => 8,
    _rb_fx_params: () => 4096,
    _rb_fx_channel: (_h: number, ch: number) => 8192 + ch * 1024,
    _rb_fx_sample_alloc: () => 65536,
    ...overrides,
  });
}

let Processor: new () => ProcessorInstance;

beforeAll(async () => {
  vi.stubGlobal('AudioWorkletProcessor', class {
    port = { postMessage: vi.fn(), onmessage: null };
  });
  vi.stubGlobal('registerProcessor', (_name: string, ctor: new () => ProcessorInstance) => {
    Processor = ctor;
  });
  vi.stubGlobal('sampleRate', 48000);
  await import('../rubberband-processor');
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function boot(module: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  nextModule = module;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const processor = new Processor();
  await processor.handleMessage({
    data: {
      type: 'INIT_WASM',
      inputBuffer: new SharedArrayBuffer(64),
      outputBuffer: new SharedArrayBuffer(64),
      wasmBinary: new ArrayBuffer(8),
      ...extra,
    },
  });
  const posted = processor.port.postMessage.mock.calls.map((c) => c[0] as Posted);
  return { processor, posted, warn };
}

describe('RubberBandProcessor FX backend selection', () => {
  it('runs the native chain when rubberband.wasm has the rb_fx exports', async () => {
    const { posted, warn } = await boot(fxModule());
    expect(posted).toContainEqual({ type: 'READY', fxBackend: 'native', fxReason: undefined });
    expect(warn).not.toHaveBeenCalled();
  });

  it('falls back to TS with a reason when the exports are missing — never silently', async () => {
    const { posted, warn } = await boot(stretcherOnlyModule());
    const ready = posted.find((m) => m.type === 'READY');
    expect(ready).toMatchObject({ fxBackend: 'ts', fxReason: expect.stringContaining('no rb_fx_* exports') });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('TypeScript fallback'));
  });

  it('honours an explicit fxBackend: ts request', async () => {
    const { posted } = await boot(fxModule(), { fxBackend: 'ts' });
    expect(posted.find((m) => m.type === 'READY')).toMatchObject({ fxBackend: 'ts', fxReason: expect.stringContaining('forced') });
  });

  it('reports FX_BACKEND ts when the native chain fails mid-session', async () => {
    const { processor } = await boot(fxModule({ _rb_fx_sample_alloc: () => 0 }));
    processor.port.postMessage.mockClear();
    await processor.handleMessage({ data: { type: 'loadBuffer', data: { buffer: new Float32Array(256).buffer } } });
    expect(processor.port.postMessage).toHaveBeenCalledWith({
      type: 'FX_BACKEND',
      backend: 'ts',
      reason: expect.stringContaining('rb_fx_sample_alloc'),
    });
  });
});

describe('RubberBandProcessor native FX runtime failure', () => {
  const block = (frames: number) => ({
    outputs: [[new Float32Array(frames), new Float32Array(frames)]],
    parameters: Object.fromEntries(
      RUBBERBAND_PARAMETER_DESCRIPTORS.map((d) => [d.name, new Float32Array([d.defaultValue])]),
    ),
  });

  it('switches to TS and reports it when rb_fx_process throws, without dropping later blocks', async () => {
    const throwing = fxModule({ _rb_fx_process: () => { throw new Error('boom'); } });
    Object.assign(throwing, {
      RubberBandStretcher: class extends FakeStretcher {
        available() { return 128; }
        retrieve() { return 128; }
      },
      _malloc: () => 32768,
    });
    const { processor } = await boot(throwing);
    processor.port.postMessage.mockClear();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { outputs, parameters } = block(128);

    const p = processor as unknown as { process(i: unknown, o: Float32Array[][], p: Record<string, Float32Array>): boolean };
    p.process([], outputs, parameters);
    p.process([], outputs, parameters);

    const fxMessages = processor.port.postMessage.mock.calls.map((c) => c[0] as Posted).filter((m) => m.type === 'FX_BACKEND');
    expect(fxMessages).toEqual([{ type: 'FX_BACKEND', backend: 'ts', reason: expect.stringContaining('rb_fx_process: Error: boom') }]);
    expect(errors).not.toHaveBeenCalledWith('DSP Error:', expect.anything());
  });

  it('does not blame the FX chain for a stretcher error', async () => {
    const module = fxModule();
    Object.assign(module, {
      RubberBandStretcher: class extends FakeStretcher {
        available(): number { throw new Error('stretcher exploded'); }
      },
    });
    const { processor } = await boot(module);
    processor.port.postMessage.mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { outputs, parameters } = block(128);
    (processor as unknown as { process(i: unknown, o: Float32Array[][], p: Record<string, Float32Array>): boolean })
      .process([], outputs, parameters);
    expect(processor.port.postMessage.mock.calls.map((c) => c[0] as Posted).filter((m) => m.type === 'FX_BACKEND')).toEqual([]);
  });
});

describe('RubberBandProcessor spectral stage', () => {
  it('splits and compresses once per block on the TS chain (no second compressor pass)', async () => {
    const { SpectralBandProcessor } = await import('../rubberband/spectralEffects');
    const module = fxModule();
    Object.assign(module, {
      RubberBandStretcher: class extends FakeStretcher {
        available() { return 128; }
        retrieve() { return 128; }
      },
      _malloc: () => 32768,
    });

    const { processor } = await boot(module, { fxBackend: 'ts' });
    const split = vi.spyOn(SpectralBandProcessor.prototype, 'applyBandSplitAndCompression');
    const parameters = Object.fromEntries(
      RUBBERBAND_PARAMETER_DESCRIPTORS.map((d) => [d.name, new Float32Array([d.name === 'spectralComp' ? 1 : d.defaultValue])]),
    );
    (processor as unknown as { process(i: unknown, o: Float32Array[][], p: Record<string, Float32Array>): boolean })
      .process([], [[new Float32Array(128), new Float32Array(128)]], parameters);
    expect(split).toHaveBeenCalledTimes(1);
  });
});

describe('RubberBandProcessor spatial routing', () => {
  it.each(['native', 'ts'] as const)('routes the %s backend output only with stereo phoneme context', async (fxBackend) => {
    const module = fxModule({
      RubberBandStretcher: class extends FakeStretcher {
        available() { return 128; }
        retrieve() { return 128; }
      },
      _malloc: () => 32768,
    });
    const { processor } = await boot(module, { fxBackend });
    const route = vi.spyOn(SpatialRouter.prototype, 'process');
    const outputs = [[new Float32Array(128), new Float32Array(128)]];
    const parameters = Object.fromEntries(
      RUBBERBAND_PARAMETER_DESCRIPTORS.map((d) => [
        d.name, new Float32Array([d.name === 'spatialRouting' ? 0.5 : d.defaultValue]),
      ]),
    );
    const p = processor as unknown as {
      process(i: unknown, o: Float32Array[][], p: Record<string, Float32Array>): boolean;
    };
    p.process([], outputs, parameters);
    expect(route).not.toHaveBeenCalled();

    await processor.handleMessage({
      data: { type: 'loadBuffer', data: { buffer: new Float32Array(256).buffer } },
    });
    await processor.handleMessage({
      data: {
        type: 'setPhonemeData',
        data: {
          sharedBuffer: new Float32Array([1, 0, 256, 0, 1, 0.75, 0, -1, -1, -1, -1]).buffer,
          ratios: [1],
        },
      },
    });
    await processor.handleMessage({ data: { type: 'noteOn', data: { pitch: 1 } } });

    p.process([], outputs, parameters);
    expect(route).toHaveBeenCalledTimes(1);
    expect(route).toHaveBeenCalledWith(outputs, 0.5, 0, 0, 0.75);

    route.mockClear();
    parameters.spatialRouting[0] = 0;
    p.process([], outputs, parameters);
    expect(route).toHaveBeenCalledTimes(1);
    expect(route).toHaveBeenCalledWith(outputs, 0, 0, 0, 0.75);

    route.mockClear();
    p.process([], [[new Float32Array(128)]], parameters);
    expect(route).not.toHaveBeenCalled();
  });
});

describe('RubberBandProcessor phoneme delay', () => {
  it('declares phonemeDelayAmount / phonemeDelayFeedback AudioParams (setWorkletParam would no-op otherwise)', () => {
    const names = RUBBERBAND_PARAMETER_DESCRIPTORS.map((d) => d.name);
    expect(names).toContain('phonemeDelayAmount');
    expect(names).toContain('phonemeDelayFeedback');
  });

  it.each(['native', 'ts'] as const)('runs after the %s chain every block, including after the stretcher runs dry', async (fxBackend) => {
    const module = fxModule({ _malloc: () => 32768 });
    const { processor } = await boot(module, { fxBackend });
    const delay = vi.spyOn(PhonemeDelay.prototype, 'process');
    const parameters = Object.fromEntries(
      RUBBERBAND_PARAMETER_DESCRIPTORS.map((d) => [
        d.name,
        new Float32Array([d.name === 'phonemeDelayAmount' ? 0.6 : d.name === 'phonemeDelayFeedback' ? 0.4 : d.defaultValue]),
      ]),
    );
    const outputs = [[new Float32Array(128), new Float32Array(128)]];
    // FakeStretcher has nothing available: the tail must still be processed.
    (processor as unknown as { process(i: unknown, o: Float32Array[][], p: Record<string, Float32Array>): boolean })
      .process([], outputs, parameters);
    expect(delay).toHaveBeenCalledWith(
      outputs[0][0], outputs[0][1], expect.closeTo(0.6, 5), expect.closeTo(0.4, 5),
      expect.objectContaining({ hasPhonemeContext: false }),
    );
  });
});

describe('RubberBandProcessor sidechain trigger rings', () => {
  const run = async (bassSidechainSAB: unknown, drumSidechainSAB: unknown) => {
    const { processor } = await boot(fxModule({ _malloc: () => 32768 }), { bassSidechainSAB, drumSidechainSAB });
    const bass = vi.spyOn(BassEnvelopeFollower.prototype, 'process');
    const drum = vi.spyOn(DrumDuckEnvelope.prototype, 'process');
    const parameters = Object.fromEntries(
      RUBBERBAND_PARAMETER_DESCRIPTORS.map((d) => [d.name, new Float32Array([d.defaultValue])]),
    );
    (processor as unknown as { process(i: unknown, o: Float32Array[][], p: Record<string, Float32Array>): boolean })
      .process([], [[new Float32Array(128), new Float32Array(128)]], parameters);
    return { bassArg: bass.mock.calls[0]?.[0], drumArg: drum.mock.calls[0]?.[0] };
  };

  it('hands the rings sent in INIT_WASM to the follower and the drum duck', async () => {
    const bassRing = createSidechainRing(BASS_TRIGGER_STRIDE);
    const drumRing = createSidechainRing(DRUM_TRIGGER_STRIDE);
    const { bassArg, drumArg } = await run(bassRing, drumRing);
    expect(bassArg).toBe(bassRing);
    expect(drumArg).toBe(drumRing);
  });

  it('ignores an old single-slot Float32 SAB instead of misreading it', async () => {
    const { bassArg, drumArg } = await run(new SharedArrayBuffer(3 * 4), new SharedArrayBuffer(4 * 4));
    expect(bassArg).toBeNull();
    expect(drumArg).toBeNull();
  });
});
