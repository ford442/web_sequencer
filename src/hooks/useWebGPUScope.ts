// hooks/useWebGPUScope.ts
import { useEffect, useRef } from 'react';
import type { SynthParams } from '../types';
import { noteToFrequency } from '../constants';
import { engineDegradationStore } from '../stores/engineDegradationStore';

// ---------------------------------------------------------
// 1. WGSL Shader Code
// ---------------------------------------------------------
const COMPUTE_SHADER_CODE = `
struct Params {
  waveform: u32,       // 0: saw, 1: square, 2: tri, 3: sine
  frequency: f32,      // normalized frequency for viz
  filterCutoff: f32,   // Hz value (typically 20–20000)
  sustain: f32,        // sustain level 0-1 (was filterRes)
  attack: f32,
  decay: f32,
  volume: f32,
  time: f32,           // animation time
}

struct Point {
  position: vec2<f32>,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> outputBuffer: array<Point>;

const PI: f32 = 3.14159265359;

// Helper: Basic Oscillators (matching WebGpuOscillator.ts for visual accuracy)
fn saw(t: f32) -> f32 { return 2.0 * fract(t) - 1.0; }
fn square(t: f32) -> f32 { return select(-1.0, 1.0, fract(t) < 0.5); }
fn tri(t: f32) -> f32 { return 2.0 * abs(2.0 * fract(t) - 1.0) - 1.0; }
fn sine(t: f32) -> f32 { return sin(2.0 * PI * t); }

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let index = global_id.x;
  let totalPoints = 1024u; // Must match WORKGROUP_SIZE * dispatch count
  
  if (index >= totalPoints) { return; }

  // Normalized X (0.0 to 1.0)
  let x = f32(index) / f32(totalPoints);
  
  // Calculate Waveform
  // We zoom out a bit to show a few cycles based on frequency
  let t = x * (1.0 + params.frequency * 10.0) + params.time; 
  
  var amplitude: f32 = 0.0;
  // Note: switch case works with u32 in WGSL
  switch (params.waveform) {
    case 0u: { amplitude = saw(t); }
    case 1u: { amplitude = square(t); }
    case 2u: { amplitude = tri(t); }
    case 3u: { amplitude = sine(t); }
    default: { amplitude = 0.0; }
  }

  // Simple Filter Simulation (Visual approximation)
  // Low cutoff blends signal towards sine; uses Hz value normalized by Nyquist (20 kHz)
  let cutoffFactor = clamp(params.filterCutoff / 20000.0, 0.0, 1.0);
  amplitude = mix(sine(t) * 0.5, amplitude, clamp(cutoffFactor * 2.0, 0.0, 1.0));

  // Envelope Simulation (Visual ADSR)
  // X axis represents time; each phase occupies a proportional segment
  var env: f32 = 0.0;
  let attackEnd = params.attack * 0.3;
  let decayEnd = attackEnd + params.decay * 0.25;
  let sustainEnd = decayEnd + 0.25; // fixed sustain window for display
  let sustainLevel = clamp(params.sustain, 0.0, 1.0);

  if (attackEnd > 0.0 && x < attackEnd) {
    env = x / attackEnd;
  } else if (x < decayEnd) {
    let decaySpan = decayEnd - attackEnd;
    env = select(1.0, 1.0 - ((x - attackEnd) / decaySpan) * (1.0 - sustainLevel), decaySpan > 0.0);
  } else if (x < sustainEnd) {
    env = sustainLevel;
  } else {
    // Release: fade from sustain to 0 over remaining x range
    let releaseSpan = 1.0 - sustainEnd;
    env = select(0.0, sustainLevel * (1.0 - (x - sustainEnd) / releaseSpan), releaseSpan > 0.0);
  }

  // Apply Volume and Envelope
  let y = amplitude * params.volume * env;

  // Write to Storage Buffer (Mapped to Vertex Shader input)
  // X range: -1 to 1, Y range: -1 to 1
  outputBuffer[index].position = vec2<f32>(x * 2.0 - 1.0, y * 0.9);
}
`;

const VERTEX_FRAGMENT_SHADER = `
struct Point {
  position: vec2<f32>,
}

@group(0) @binding(1) var<storage, read> inputBuffer: array<Point>;

struct VertexOutput {
  @builtin(position) Position : vec4<f32>,
  @location(0) color : vec4<f32>,
}

@group(0) @binding(2) var<uniform> accentColor: vec4<f32>;

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex : u32) -> VertexOutput {
  let point = inputBuffer[vertexIndex];
  var output : VertexOutput;
  output.Position = vec4<f32>(point.position, 0.0, 1.0);
  output.color = accentColor; 
  return output;
}

@fragment
fn fs_main(@location(0) color : vec4<f32>) -> @location(0) vec4<f32> {
  return color;
}
`;

// ---------------------------------------------------------
// 2. The Hook
// ---------------------------------------------------------
export const useWebGPUScope = (
  canvasRef: React.RefObject<HTMLCanvasElement>,
  params: SynthParams,
  accentColor: 'cyan' | 'pink',
  initDelay: number = 0
) => {
  const deviceRef = useRef<GPUDevice | null>(null);
  const pipelineRef = useRef<GPUComputePipeline | null>(null);
  const renderPipelineRef = useRef<GPURenderPipeline | null>(null);
  const uniformBufferRef = useRef<GPUBuffer | null>(null);
  const storageBufferRef = useRef<GPUBuffer | null>(null);
  const accentColorBufferRef = useRef<GPUBuffer | null>(null);
  const bindGroupRef = useRef<GPUBindGroup | null>(null);
  const animationRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);

  // PERFORMANCE: Use refs to hold latest params/color to avoid re-running the effect loop
  // This allows the animation loop to persist while parameters update.
  const paramsRef = useRef(params);
  const accentColorRef = useRef(accentColor);

  const WORKGROUP_SIZE = 64;
  const NUM_POINTS = 1024;

  // Sync props to refs
  useEffect(() => {
    paramsRef.current = params;
    accentColorRef.current = accentColor;
  }, [params, accentColor]);

  useEffect(() => {
    let isCleanedUp = false;

    const initWebGPU = async () => {
      if (!canvasRef.current || !navigator.gpu) return;

      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter || isCleanedUp) {
        if (!adapter) {
          engineDegradationStore.report({
            id: 'webgpu-scope',
            subsystem: 'webgpu-scope',
            category: 'gpu',
            message: 'Oscilloscope using static fallback',
            reason: 'requestAdapter() returned null',
            status: 'active',
            activeBackend: 'static',
            requestedBackend: 'webgpu',
            retryable: false,
          });
        }
        return;
      }
      const device = await adapter.requestDevice();
      if (isCleanedUp) {
          device.destroy();
          return;
      }
      deviceRef.current = device;

      const context = canvasRef.current.getContext('webgpu');
      if (!context) return;

      const format = navigator.gpu.getPreferredCanvasFormat();
      context.configure({ device, format });

      // 1. Create Layouts & Pipelines
      const computeModule = device.createShaderModule({ code: COMPUTE_SHADER_CODE });
      const renderModule = device.createShaderModule({ code: VERTEX_FRAGMENT_SHADER });

      const bindGroupLayout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE | GPUShaderStage.VERTEX, buffer: { type: 'storage' } },
          { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        ],
      });

      const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });

      pipelineRef.current = device.createComputePipeline({
        layout: pipelineLayout,
        compute: { module: computeModule, entryPoint: 'main' },
      });

      renderPipelineRef.current = device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: { module: renderModule, entryPoint: 'vs_main' },
        fragment: { module: renderModule, entryPoint: 'fs_main', targets: [{ format }] },
        primitive: { topology: 'line-strip' },
      });

      // 2. Create Buffers
      // Param Buffer: 32 bytes (8 floats/u32s) aligned
      uniformBufferRef.current = device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      // Storage Buffer: 1024 points * 2 floats (vec2) * 4 bytes = 8192 bytes
      storageBufferRef.current = device.createBuffer({
        size: NUM_POINTS * 2 * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX,
      });

      // Accent Color Buffer: 16 bytes (vec4)
      accentColorBufferRef.current = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      // 3. Create Bind Group
      bindGroupRef.current = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: uniformBufferRef.current } },
          { binding: 1, resource: { buffer: storageBufferRef.current } },
          { binding: 2, resource: { buffer: accentColorBufferRef.current } },
        ],
      });

      // ---------------------------------------------------------
      // 3. Render Loop
      // ---------------------------------------------------------
      const renderFrame = () => {
        if (isCleanedUp || !deviceRef.current) return;

        const device = deviceRef.current;
        const currentParams = paramsRef.current;
        const currentAccent = accentColorRef.current;

        // Map Waveform string to int
        // Handle other waveform types by defaulting to basic ones
        let waveIndex = 0;
        if (currentParams.waveform.includes('saw')) waveIndex = 0;
        else if (currentParams.waveform.includes('squ') || currentParams.waveform.includes('sqr')) waveIndex = 1;
        else if (currentParams.waveform.includes('tri')) waveIndex = 2;
        else if (currentParams.waveform.includes('sin')) waveIndex = 3;

        // Normalize frequency purely for visualization scale
        const freq = noteToFrequency('C4') / 1000.0;

        // WRITE PARAMS TO GPU
        // Structure must match WGSL struct Params exactly
        // slot 3: sustain level derived from volume (0-1 range) — filterResonance repurposed
        const sustainLevel = Math.max(0, Math.min(1, currentParams.volume));
        const paramData = new Float32Array([
          0, // placeholder for u32 waveform (we'll cast view)
          freq,
          currentParams.filterCutoff,
          sustainLevel,       // sustain (was filterResonance)
          currentParams.attack,
          currentParams.decay,
          currentParams.volume,
          (Date.now() - startTimeRef.current) / 1000.0 // Update time
        ]);

        // Cast to uint32 for the first slot
        const uintView = new Uint32Array(paramData.buffer);
        uintView[0] = waveIndex;

        // UPDATE ACCENT COLOR
        const colorData = currentAccent === 'cyan'
          ? new Float32Array([0.2, 0.9, 1.0, 1.0])
          : new Float32Array([1.0, 0.2, 0.8, 1.0]);

        // Check refs before writing to avoid null access if something went wrong
        if (accentColorBufferRef.current) {
             device.queue.writeBuffer(accentColorBufferRef.current, 0, colorData);
        }
        if (uniformBufferRef.current) {
            device.queue.writeBuffer(uniformBufferRef.current, 0, paramData);
        }

        const commandEncoder = device.createCommandEncoder();

        // COMPUTE PASS
        const computePass = commandEncoder.beginComputePass();
        computePass.setPipeline(pipelineRef.current!);
        computePass.setBindGroup(0, bindGroupRef.current!);
        computePass.dispatchWorkgroups(Math.ceil(NUM_POINTS / WORKGROUP_SIZE));
        computePass.end();

        // RENDER PASS
        const textureView = context.getCurrentTexture().createView();
        const renderPass = commandEncoder.beginRenderPass({
          colorAttachments: [{
            view: textureView,
            clearValue: { r: 0.05, g: 0.05, b: 0.07, a: 1.0 }, // bg-gray-900 equivalent
            loadOp: 'clear',
            storeOp: 'store',
          }],
        });

        renderPass.setPipeline(renderPipelineRef.current!);
        renderPass.setBindGroup(0, bindGroupRef.current!);
        renderPass.draw(NUM_POINTS);
        renderPass.end();

        device.queue.submit([commandEncoder.finish()]);
        animationRef.current = requestAnimationFrame(renderFrame);
      };

      startTimeRef.current = Date.now();
      renderFrame();
    };

    // Use setTimeout to stagger WebGPU initialization between components
    const initTimeoutId = setTimeout(() => {
      initWebGPU();
    }, initDelay);

    return () => {
      // cleanup
      isCleanedUp = true;
      clearTimeout(initTimeoutId);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (deviceRef.current) deviceRef.current.destroy();
    };
  }, [initDelay, canvasRef]);
};
