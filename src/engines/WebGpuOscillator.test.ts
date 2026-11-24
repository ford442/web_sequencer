
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebGpuOscillator } from './WebGpuOscillator';
import { resetWebGpuProbe } from './backends/webgpuProbe';
import { SHAPE_INDEX, WAVETABLE_LENGTH, planWavetableBands } from './backends/wavetableBands';

// Types for mocking
type MockGPUDevice = {
  createShaderModule: ReturnType<typeof vi.fn>;
  createBindGroupLayout: ReturnType<typeof vi.fn>;
  createPipelineLayout: ReturnType<typeof vi.fn>;
  createComputePipeline: ReturnType<typeof vi.fn>;
  createBuffer: ReturnType<typeof vi.fn>;
  createBindGroup: ReturnType<typeof vi.fn>;
  createCommandEncoder: ReturnType<typeof vi.fn>;
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
      const sqrBand2 = 4 + (bands.length + 2) * 4;
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
      expect(u[4]).toBe(Math.round((440 / 48000) * 2 ** 32));
      expect(u[5]).toBe(54); // floor(24000 / 440): nothing past Nyquist
      expect(u[6]).toBe(SHAPE_INDEX.tri);
      expect(u[7]).toBe(0);
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
      const src = (engine as unknown as { SHADER_CODE: string }).SHADER_CODE;
      // Shape indices match SHAPE_INDEX (saw 0, sqr 1, tri 2, sin default).
      expect(SHAPE_INDEX).toEqual({ saw: 0, sqr: 1, tri: 2, sin: 3 });
      expect(src).toMatch(/case 0u:[\s\S]*sin\(rad\(ph\)\) \/ f32\(h\)[\s\S]*-2\.0 \/ PI/);
      expect(src).toMatch(/case 1u:[\s\S]*h = h \+ 2u[\s\S]*4\.0 \/ PI/);
      expect(src).toMatch(/case 2u:[\s\S]*cos\(rad\(ph\)\) \/ \(fh \* fh\)[\s\S]*8\.0 \/ \(PI \* PI\)/);
      expect(src).toContain('let p1 = index * inc;');
      expect(src).toContain('const MAX_TABLES: u32 = 64u;');
    });
  });
});
