
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebGpuOscillator } from './WebGpuOscillator';
import { oscillatorShader } from './WebGpuOscillatorShader';
import { resetWebGpuProbe } from './backends/webgpuProbe';
import { SHAPE_INDEX, WAVETABLE_LENGTH, planWavetableBands } from './backends/wavetableBands';
import { BANK_NOTE_COUNT, planFilteredBank, type GpuFilterSpec } from './backends/gpuFilter';

// Types for mocking
type MockGPUDevice = {
  createShaderModule: ReturnType<typeof vi.fn>;
  createBindGroupLayout: ReturnType<typeof vi.fn>;
  createPipelineLayout: ReturnType<typeof vi.fn>;
  createComputePipeline: ReturnType<typeof vi.fn>;
  createBuffer: ReturnType<typeof vi.fn>;
  createBindGroup: ReturnType<typeof vi.fn>;
  createCommandEncoder: ReturnType<typeof vi.fn>;
  /** Only the tests that exercise shader validation add these. */
  pushErrorScope?: ReturnType<typeof vi.fn>;
  popErrorScope?: ReturnType<typeof vi.fn>;
  queue: {
    writeBuffer: ReturnType<typeof vi.fn>;
    submit: ReturnType<typeof vi.fn>;
  };
};

describe('WebGpuOscillator', () => {
  let engine: WebGpuOscillator;
  let mockDevice: MockGPUDevice;
  let mockAdapter: Record<string, unknown>;

  beforeEach(() => {
    resetWebGpuProbe();
    engine = new WebGpuOscillator();

    // Reset mocks
    vi.clearAllMocks();

    // Mock GPU API structures
    const mockQueue = {
      writeBuffer: vi.fn(),
      submit: vi.fn(),
    };

    mockDevice = {
      createShaderModule: vi.fn().mockReturnValue({}), // Return object
      createBindGroupLayout: vi.fn().mockReturnValue({}), // Return object
      createPipelineLayout: vi.fn().mockReturnValue({}), // Return object
      createComputePipeline: vi.fn().mockReturnValue({}), // Return object
      createBuffer: vi.fn(() => ({
        destroy: vi.fn(),
        mapAsync: vi.fn().mockResolvedValue(undefined),
        getMappedRange: vi.fn(() => new Float32Array(100).buffer),
        unmap: vi.fn(),
      })),
      createBindGroup: vi.fn().mockReturnValue({}), // Return object
      createCommandEncoder: vi.fn(() => ({
        beginComputePass: vi.fn(() => ({
          setPipeline: vi.fn(),
          setBindGroup: vi.fn(),
          dispatchWorkgroups: vi.fn(),
          end: vi.fn(),
        })),
        copyBufferToBuffer: vi.fn(),
        finish: vi.fn(),
      })),
      queue: mockQueue,
    };

    mockAdapter = {
      requestDevice: vi.fn().mockResolvedValue(mockDevice),
    };

    // Mock global navigator.gpu
    // @ts-ignore
    global.navigator.gpu = {
      requestAdapter: vi.fn().mockResolvedValue(mockAdapter),
    };

    // Mock global GPU constants
    // @ts-ignore
    global.GPUShaderStage = { COMPUTE: 1 };
    // @ts-ignore
    global.GPUBufferUsage = {
        STORAGE: 1,
        COPY_SRC: 2,
        MAP_READ: 4,
        COPY_DST: 8,
        UNIFORM: 16
    };
    // @ts-ignore
    global.GPUMapMode = { READ: 1 };
  });

  it('should initialize correctly when WebGPU is supported', async () => {
    await engine.init();

    expect(global.navigator.gpu.requestAdapter).toHaveBeenCalled();
    expect((mockAdapter.requestDevice as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    expect(mockDevice.createShaderModule).toHaveBeenCalled();
    expect(mockDevice.createComputePipeline).toHaveBeenCalled();
    expect(engine.isSupported).toBe(true);
  });

  it('should handle lack of WebGPU support gracefully', async () => {
    // @ts-ignore
    global.navigator.gpu = undefined;

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await engine.init();

    expect(engine.isSupported).toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[EngineFallback] webgpu'),
    );
  });

  it('should generate audio data', async () => {
    await engine.init();

    const result = await engine.generate(440, 1.0, 44100, 'saw');

    expect(mockDevice.createBuffer).toHaveBeenCalledTimes(3); // Output, Read, Uniform
    expect(mockDevice.queue.writeBuffer).toHaveBeenCalled();
    expect(mockDevice.createCommandEncoder).toHaveBeenCalled();
    expect(result).toBeInstanceOf(Float32Array);
  });

  it('should return null if generate is called before init', async () => {
      const result = await engine.generate(440, 1.0, 44100, 'saw');
      expect(result).toBeNull();
  });

  describe('band-limited kernel (#1668)', () => {
    /** Capture what each dispatch was asked for. */
    function capture() {
      const dispatches: unknown[][] = [];
      mockDevice.createCommandEncoder.mockImplementation(() => ({
        beginComputePass: vi.fn(() => ({
          setPipeline: vi.fn(),
          setBindGroup: vi.fn(),
          dispatchWorkgroups: vi.fn((...args: unknown[]) => dispatches.push(args)),
          end: vi.fn(),
        })),
        copyBufferToBuffer: vi.fn(),
        finish: vi.fn(),
      }));
      // Read buffer maps back as large as the request, filled with 0.25.
      mockDevice.createBuffer.mockImplementation((desc: { size: number }) => ({
        destroy: vi.fn(),
        mapAsync: vi.fn().mockResolvedValue(undefined),
        getMappedRange: vi.fn(() => new Float32Array(desc.size / 4).fill(0.25).buffer),
        unmap: vi.fn(),
      }));
      return dispatches;
    }

    /** The u32 uniform block of the last dispatch. */
    function lastUniform(): Uint32Array {
      const calls = mockDevice.queue.writeBuffer.mock.calls;
      return calls[calls.length - 1][2] as Uint32Array;
    }

    it('renders every shape × band in one dispatch and one submit', async () => {
      const dispatches = capture();
      await engine.init();
      const set = await engine.renderWavetables(48000);

      const bands = planWavetableBands(48000);
      expect(set).not.toBeNull();
      expect(set!.bands).toEqual(bands);
      expect(set!.length).toBe(WAVETABLE_LENGTH);
      expect(mockDevice.queue.submit).toHaveBeenCalledTimes(1);
      expect(dispatches).toEqual([[WAVETABLE_LENGTH / 64, 4 * bands.length]]);
      for (const shape of ['saw', 'sqr', 'tri', 'sin'] as const) {
        expect(set!.tables[shape]).toHaveLength(bands.length);
        for (const t of set!.tables[shape]) expect(t.length).toBe(WAVETABLE_LENGTH);
      }

      const u = lastUniform();
      expect(u[0]).toBe(WAVETABLE_LENGTH);
      expect(u[1]).toBe(4 * bands.length);
      // Table k = shape-major: saw bands first, then sqr, …
      const sqrBand2 = 12 + (bands.length + 2) * 4;
      expect(u[sqrBand2]).toBe(bands[2].phaseIncrement);
      expect(u[sqrBand2 + 1]).toBe(bands[2].maxHarmonic);
      expect(u[sqrBand2 + 2]).toBe(SHAPE_INDEX.sqr);
      expect(u[sqrBand2 + 3]).toBe((bands.length + 2) * WAVETABLE_LENGTH);
    });

    it('offline generate is one band-limited table at an exact fixed-point pitch', async () => {
      const dispatches = capture();
      await engine.init();
      const out = await engine.generate(440, 0.5, 48000, 'tri');

      expect(out).toHaveLength(24000);
      expect(dispatches).toEqual([[Math.ceil(24000 / 64), 1]]);
      const u = lastUniform();
      expect(u[0]).toBe(24000);
      expect(u[1]).toBe(1);
      expect(u[12]).toBe(Math.round((440 / 48000) * 2 ** 32));
      expect(u[13]).toBe(54); // floor(24000 / 440): nothing past Nyquist
      expect(u[14]).toBe(SHAPE_INDEX.tri);
      expect(u[15]).toBe(0);
      expect(u[2]).toBe(3); // no filter
      expect(u[3]).toBe(0); // and no coefficient region
    });

    it('refuses pitches it cannot render instead of returning garbage', async () => {
      capture();
      await engine.init();
      expect(await engine.generate(24000, 0.1, 48000, 'saw')).toBeNull();
      expect(await engine.generate(0, 0.1, 48000, 'saw')).toBeNull();
      expect(await engine.generate(Number.NaN, 0.1, 48000, 'saw')).toBeNull();
      expect(await engine.generate(440, 0, 48000, 'saw')).toBeNull();
      expect(mockDevice.queue.submit).not.toHaveBeenCalled();
    });

    it('fails closed when readback fails', async () => {
      capture();
      mockDevice.createBuffer.mockImplementation(() => ({
        destroy: vi.fn(),
        mapAsync: vi.fn().mockRejectedValue(new Error('device lost')),
        getMappedRange: vi.fn(),
        unmap: vi.fn(),
      }));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      await engine.init();
      expect(await engine.renderWavetables(48000)).toBeNull();
    });

    it('shader keeps the series and shape indices the TS mirror tests', () => {
      const src = oscillatorShader(128);
      // Shape indices match SHAPE_INDEX (saw 0, sqr 1, tri 2, sin default).
      expect(SHAPE_INDEX).toEqual({ saw: 0, sqr: 1, tri: 2, sin: 3 });
      expect(src).toMatch(/case 0u:[\s\S]*sin\(rad\(ph\)\) \/ f32\(h\)[\s\S]*-2\.0 \/ PI/);
      expect(src).toMatch(/case 1u:[\s\S]*h = h \+ 2u[\s\S]*4\.0 \/ PI/);
      expect(src).toMatch(/case 2u:[\s\S]*cos\(rad\(ph\)\) \/ \(fh \* fh\)[\s\S]*8\.0 \/ \(PI \* PI\)/);
      expect(src).toContain('let p1 = index * inc;');
      expect(src).toContain('const MAX_TABLES: u32 = 128u;');
    });
  });
  describe('filter in the kernel (#1675)', () => {
    const LP: GpuFilterSpec = { type: 'lp', cutoff: 1000, q: 4 };

    /** Record every pass (which entry point, what dispatch), every buffer size and every copy. */
    function capture() {
      const passes: Array<{ entry?: string; dispatch: unknown[] }> = [];
      const copies: unknown[][] = [];
      const sizes: number[] = [];
      mockDevice.createComputePipeline.mockImplementation((d: { compute: { entryPoint: string } }) => ({ entry: d.compute.entryPoint }));
      mockDevice.createCommandEncoder.mockImplementation(() => ({
        beginComputePass: vi.fn(() => {
          const pass: { entry?: string; dispatch: unknown[] } = { dispatch: [] };
          passes.push(pass);
          return {
            setPipeline: vi.fn((pl: { entry: string }) => { pass.entry = pl.entry; }),
            setBindGroup: vi.fn(),
            dispatchWorkgroups: vi.fn((...a: unknown[]) => { pass.dispatch = a; }),
            end: vi.fn(),
          };
        }),
        copyBufferToBuffer: vi.fn((...a: unknown[]) => copies.push(a)),
        finish: vi.fn(),
      }));
      mockDevice.createBuffer.mockImplementation((desc: { size: number }) => {
        sizes.push(desc.size);
        return {
          destroy: vi.fn(),
          mapAsync: vi.fn().mockResolvedValue(undefined),
          getMappedRange: vi.fn(() => new Float32Array(desc.size / 4).fill(0.5).buffer),
          unmap: vi.fn(),
        };
      });
      return { passes, copies, sizes };
    }

    /** The uniform block of the last dispatch, as u32 and f32 views of the same bytes. */
    function lastUniform() {
      const calls = mockDevice.queue.writeBuffer.mock.calls;
      const u32 = calls[calls.length - 1][2] as Uint32Array;
      return { u32, f32: new Float32Array(u32.buffer, u32.byteOffset, u32.length) };
    }

    it('runs the coefficient pass, then the synthesis pass, and reads back only the audio', async () => {
      const { passes, copies, sizes } = capture();
      await engine.init();
      const out = await engine.generate(440, 0.5, 48000, 'saw', LP);

      expect(out).toHaveLength(24000);
      expect(passes.map((p) => p.entry)).toEqual(['coeffs', 'main']);
      const stride = 54; // floor(24000 / 440)
      expect(passes[0].dispatch).toEqual([1, 1]); // one thread per harmonic
      expect(passes[1].dispatch).toEqual([Math.ceil(24000 / 64), 1]);

      const { u32, f32 } = lastUniform();
      expect(u32[2]).toBe(0); // lowpass
      expect(u32[3]).toBe(stride);
      expect(f32[4]).toBe(Math.fround(Math.tan((Math.PI * 1000) / 48000)));
      expect(f32[5]).toBe(0.25);
      expect(u32[8]).toBe(24000); // the coefficient region starts after the audio
      expect(f32[524]).toBe(Math.fround(440 / 48000)); // the audible fundamental, in cycles per sample

      // The storage buffer holds the audio and, behind it, a (gain, phase) pair per harmonic.
      const audioBytes = 24000 * 4;
      expect(Math.max(...sizes)).toBeGreaterThanOrEqual(audioBytes + stride * 8);
      // Only the audio is copied to the readable buffer.
      expect(copies[0].slice(1)).toEqual([0, expect.anything(), 0, audioBytes]);
    });

    it.each([
      ['lp', 0],
      ['bp', 1],
      ['hp', 2],
    ] as const)('selects the %s response (%i) in the uniform block', async (type, id) => {
      capture();
      await engine.init();
      await engine.generate(220, 0.1, 48000, 'sqr', { ...LP, type });
      expect(lastUniform().u32[2]).toBe(id);
    });

    it('refuses a filter it cannot render instead of rendering a different one', async () => {
      capture();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      await engine.init();
      const bad = [
        { ...LP, cutoff: Number.NaN },
        { ...LP, cutoff: 5 },
        { ...LP, cutoff: 23000 },
        { ...LP, q: 0 },
        { ...LP, q: Number.POSITIVE_INFINITY },
        { ...LP, type: 'notch' as unknown as 'lp' },
      ];
      for (const filter of bad) expect(await engine.generate(440, 0.1, 48000, 'saw', filter)).toBeNull();
      expect(await engine.renderFilteredBank(48000, 'saw', bad[0])).toBeNull();
      expect(mockDevice.queue.submit).not.toHaveBeenCalled();
    });

    it('renders a whole bank — one table per MIDI note, each at its own pitch — in one submit', async () => {
      const { passes } = capture();
      await engine.init();
      const bank = await engine.renderFilteredBank(48000, 'tri', LP);

      expect(bank).not.toBeNull();
      expect(bank!.tables).toHaveLength(BANK_NOTE_COUNT);
      expect(bank!.notes).toEqual(planFilteredBank(planWavetableBands(48000)));
      for (const t of bank!.tables) expect(t.length).toBe(WAVETABLE_LENGTH);
      expect(mockDevice.queue.submit).toHaveBeenCalledTimes(1);
      expect(passes.map((p) => p.entry)).toEqual(['coeffs', 'main']);
      expect(passes[1].dispatch).toEqual([WAVETABLE_LENGTH / 64, BANK_NOTE_COUNT]);

      const bands = planWavetableBands(48000);
      const { u32, f32 } = lastUniform();
      expect(u32[1]).toBe(BANK_NOTE_COUNT);
      expect(u32[3]).toBe(Math.max(...bank!.notes.map((n) => bands[n.band].maxHarmonic)));
      bank!.notes.forEach((note, i) => {
        expect(u32[12 + i * 4]).toBe(bands[note.band].phaseIncrement);
        expect(u32[12 + i * 4 + 1]).toBe(bands[note.band].maxHarmonic);
        expect(u32[12 + i * 4 + 2]).toBe(SHAPE_INDEX.tri);
        expect(u32[12 + i * 4 + 3]).toBe(i * WAVETABLE_LENGTH);
        // The response is evaluated at the note's own pitch, not the table's.
        expect(f32[524 + i * 4]).toBe(Math.fround(note.f0 / 48000));
      });
    });

    it('does not touch the coefficient machinery for an unfiltered render', async () => {
      const { passes, sizes } = capture();
      await engine.init();
      await engine.renderWavetables(48000);
      expect(passes.map((p) => p.entry)).toEqual(['main']);
      expect(lastUniform().u32[2]).toBe(3);
      expect(lastUniform().u32[3]).toBe(0);
      // Same storage buffer size as before the filter existed: audio only.
      const bands = planWavetableBands(48000);
      expect(Math.max(...sizes)).toBeLessThan(4 * bands.length * WAVETABLE_LENGTH * 4 + 4096 * 2);
    });

    it('fails closed when the bank readback fails', async () => {
      capture();
      mockDevice.createBuffer.mockImplementation(() => ({
        destroy: vi.fn(),
        mapAsync: vi.fn().mockRejectedValue(new Error('device lost')),
        getMappedRange: vi.fn(),
        unmap: vi.fn(),
      }));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      await engine.init();
      expect(await engine.renderFilteredBank(48000, 'saw', LP)).toBeNull();
    });
  });

  describe('a shader that does not compile', () => {
    it('does not leave a "supported" oscillator that renders silence', async () => {
      mockDevice = Object.assign(mockDevice, {
        pushErrorScope: vi.fn(),
        popErrorScope: vi.fn().mockResolvedValue({ message: "'filter' is a reserved keyword" }),
      });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await engine.init();

      expect(mockDevice.pushErrorScope).toHaveBeenCalledWith('validation');
      expect(mockDevice.popErrorScope).toHaveBeenCalledTimes(1);
      expect(engine.isSupported).toBe(false);
      expect(engine.pipeline).toBeNull();
      expect(engine.coefPipeline).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("pipeline is invalid: 'filter' is a reserved keyword"));
      expect(await engine.generate(440, 0.1, 48000, 'saw')).toBeNull();
    });

    it('is supported when the scope comes back clean, and pops the scope it pushed', async () => {
      mockDevice = Object.assign(mockDevice, {
        pushErrorScope: vi.fn(),
        popErrorScope: vi.fn().mockResolvedValue(null),
      });
      await engine.init();
      expect(engine.isSupported).toBe(true);
      expect(mockDevice.popErrorScope).toHaveBeenCalledTimes(1);
    });

    it('pops the scope even when pipeline creation throws', async () => {
      mockDevice = Object.assign(mockDevice, {
        pushErrorScope: vi.fn(),
        popErrorScope: vi.fn().mockResolvedValue(null),
      });
      mockDevice.createComputePipeline.mockImplementation(() => { throw new Error('boom'); });
      vi.spyOn(console, 'error').mockImplementation(() => {});
      await engine.init();
      expect(engine.isSupported).toBe(false);
      expect(mockDevice.popErrorScope).toHaveBeenCalledTimes(1);
    });

    // A mocked device cannot compile WGSL, so the one mistake it cannot see is a name WGSL
    // reserves (`filter` was one, and rendered silence on a real adapter). Keep them out.
    it('uses no reserved WGSL word as an identifier', () => {
      const src = oscillatorShader(128).replace(/\/\/.*$/gm, '');
      const RESERVED = new Set((
        'NULL Self abstract active alignas alignof as asm asm_fragment async attribute auto await become binding_array cast ' +
        'catch class co_await co_return co_yield coherent column_major common compile compile_fragment concept const_cast ' +
        'consteval constexpr constinit crate debugger decltype delete demote demote_to_helper do dynamic_cast enum explicit ' +
        'export extends extern external fallthrough filter final finally friend from fxgroup get goto groupshared highp impl ' +
        'implements import inline instanceof interface layout lowp macro macro_rules match mediump meta mod module move mut ' +
        'mutable namespace new nil noexcept noinline nointerpolation noperspective null nullptr of operator package packoffset ' +
        'partition pass patch pixelfragment precise precision premerge priv protected pub public readonly ref regardless ' +
        'register reinterpret_cast require resource restrict self set shared sizeof smooth snorm static static_assert ' +
        'static_cast std subroutine super target template this thread_local throw trait try type typedef typeid typename ' +
        'typeof union unless unorm unsafe unsized use using varying virtual volatile wgsl where with writeonly yield'
      ).split(/\s+/));
      const used = new Set(src.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []);
      expect([...used].filter((w) => RESERVED.has(w))).toEqual([]);
    });
  });
});
