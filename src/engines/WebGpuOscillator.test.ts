
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebGpuOscillator } from './WebGpuOscillator';

// Types for mocking
type MockGPUDevice = {
  createShaderModule: any;
  createBindGroupLayout: any;
  createPipelineLayout: any;
  createComputePipeline: any;
  createBuffer: any;
  createBindGroup: any;
  createCommandEncoder: any;
  queue: {
    writeBuffer: any;
    submit: any;
  };
  lost: Promise<any>;
};

describe('WebGpuOscillator', () => {
  let engine: WebGpuOscillator;
  let mockDevice: MockGPUDevice;
  let mockAdapter: any;

  beforeEach(() => {
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
      lost: new Promise(() => {}) // Mock never resolving promise for 'lost'
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
    expect(mockAdapter.requestDevice).toHaveBeenCalled();
    expect(mockDevice.createShaderModule).toHaveBeenCalled();
    expect(mockDevice.createComputePipeline).toHaveBeenCalled();
    expect(engine.isSupported).toBe(true);
  });

  it('should handle lack of WebGPU support gracefully', async () => {
    // @ts-ignore
    global.navigator.gpu = undefined;

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await engine.init();

    expect(engine.isSupported).toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith("WebGPU not supported in this browser.");
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
});
