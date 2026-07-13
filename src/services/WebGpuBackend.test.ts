import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebGpuBackend } from './WebGpuBackend';

// Minimal WebGPU mock that records how buffers are wired through a chain.
function installGpuMock() {
  const createdBuffers: any[] = [];
  const computePasses: any[] = [];
  const bindGroups: any[] = [];

  const makeBuffer = () => {
    const buf = {
      destroy: vi.fn(),
      mapAsync: vi.fn().mockResolvedValue(undefined),
      getMappedRange: vi.fn(() => new Float32Array(4096).buffer),
      unmap: vi.fn(),
    };
    createdBuffers.push(buf);
    return buf;
  };

  const mockQueue = { writeBuffer: vi.fn(), submit: vi.fn() };

  const mockDevice: any = {
    createShaderModule: vi.fn().mockReturnValue({}),
    createComputePipeline: vi.fn(() => ({ getBindGroupLayout: vi.fn().mockReturnValue({}) })),
    createBuffer: vi.fn(makeBuffer),
    createBindGroup: vi.fn((d: any) => {
      bindGroups.push(d);
      return {};
    }),
    createCommandEncoder: vi.fn(() => ({
      beginComputePass: vi.fn(() => {
        const pass = {
          setPipeline: vi.fn(),
          setBindGroup: vi.fn(),
          dispatchWorkgroups: vi.fn(),
          end: vi.fn(),
        };
        computePasses.push(pass);
        return pass;
      }),
      copyBufferToBuffer: vi.fn(),
      finish: vi.fn(),
    })),
    queue: mockQueue,
  };

  // @ts-ignore
  global.navigator.gpu = {
    requestAdapter: vi.fn().mockResolvedValue({ requestDevice: vi.fn().mockResolvedValue(mockDevice) }),
  };
  // @ts-ignore
  global.GPUBufferUsage = { STORAGE: 1, COPY_SRC: 2, MAP_READ: 4, COPY_DST: 8, UNIFORM: 16 };
  // @ts-ignore
  global.GPUMapMode = { READ: 1 };

  return { mockDevice, mockQueue, createdBuffers, computePasses, bindGroups };
}

describe('WebGpuBackend.runChain', () => {
  let backend: WebGpuBackend;
  let mocks: ReturnType<typeof installGpuMock>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks = installGpuMock();
    backend = new WebGpuBackend();
    await backend.init();
  });

  it('returns null before init / when unavailable', async () => {
    const fresh = new WebGpuBackend();
    const r = await fresh.runChain(['multiply'], new Float32Array([1, 2]), [1, 1, 2]);
    expect(r).toBeNull();
  });

  it('returns a copy of the input when ops is empty', async () => {
    const data = new Float32Array([1, 2, 3, 4]);
    const r = await backend.runChain([], data, [1, 2, 2]);
    expect(r).toBeInstanceOf(Float32Array);
    expect(Array.from(r!)).toEqual([1, 2, 3, 4]);
    expect(r).not.toBe(data); // copy, not the same reference
  });

  it('dispatches one compute pass per op and reads back exactly once', async () => {
    const data = new Float32Array(16);
    const r = await backend.runChain(['sharpen', 'quantize', 'tremolo'], data, [1, 4, 4]);

    expect(r).toBeInstanceOf(Float32Array);
    expect(mocks.computePasses).toHaveLength(3); // one pass per op
    // submit once, mapAsync once → single readback
    expect(mocks.mockQueue.submit).toHaveBeenCalledTimes(1);
    const mapped = mocks.createdBuffers.filter((b) => b.mapAsync.mock.calls.length > 0);
    expect(mapped).toHaveLength(1);
  });

  it('ping-pongs: the input of op N+1 is the output of op N', async () => {
    const data = new Float32Array(16);
    await backend.runChain(['multiply', 'add', 'multiply'], data, [1, 4, 4]);

    // binding 1 (output) of pass i must equal binding 0 (input) of pass i+1.
    const bg = mocks.bindGroups;
    expect(bg.length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < 2; i++) {
      const out = bg[i].entries.find((e: any) => e.binding === 1).resource.buffer;
      const nextIn = bg[i + 1].entries.find((e: any) => e.binding === 0).resource.buffer;
      expect(nextIn).toBe(out);
    }
  });

  it('returns null on an unknown op without leaving pool buffers mapped', async () => {
    const r = await backend.runChain(['multiply', 'bogus'], new Float32Array(16), [1, 4, 4]);
    expect(r).toBeNull();
  });

  it('reuses pooled buffers across calls (no unbounded allocation)', async () => {
    const data = new Float32Array(16);
    await backend.runChain(['multiply'], data, [1, 4, 4]);
    const afterFirst = mocks.mockDevice.createBuffer.mock.calls.length;
    await backend.runChain(['multiply'], data, [1, 4, 4]);
    const afterSecond = mocks.mockDevice.createBuffer.mock.calls.length;
    // Second call should only allocate the per-op uniform buffer; the 2 storage
    // buffers + 1 readback buffer come back from the pool.
    expect(afterSecond - afterFirst).toBeLessThan(afterFirst);
  });
});
