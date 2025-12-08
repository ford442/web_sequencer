import { useEffect, useRef } from 'react';
import type { SynthParams } from '../types';
import { noteToFrequency } from '../constants';

// Shader code remains the same as before
const SHADER_CODE = `
struct Params {
  waveform: u32,
  frequency: f32,
  filterCutoff: f32,
  filterRes: f32,
  attack: f32,
  decay: f32,
  volume: f32,
  time: f32,
}

struct Point {
  position: vec2<f32>,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> outputBuffer: array<Point>;

const PI: f32 = 3.14159265359;

fn saw(t: f32) -> f32 { return 2.0 * (t - floor(t + 0.5)); }
fn square(t: f32) -> f32 { return select(-1.0, 1.0, fract(t) < 0.5); }
fn tri(t: f32) -> f32 { return 2.0 * abs(2.0 * (t - floor(t + 0.5))) - 1.0; }
fn sine(t: f32) -> f32 { return sin(2.0 * PI * t); }

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let index = global_id.x;
  let totalPoints = 1024u;
  
  if (index >= totalPoints) { return; }

  let x = f32(index) / f32(totalPoints);
  let t = x * (1.0 + params.frequency * 10.0) + params.time; 
  
  var amplitude: f32 = 0.0;
  switch (params.waveform) {
    case 0u: { amplitude = saw(t); }
    case 1u: { amplitude = square(t); }
    case 2u: { amplitude = tri(t); }
    case 3u: { amplitude = sine(t); }
    default: { amplitude = 0.0; }
  }

  let cutoffFactor = params.filterCutoff / 15000.0;
  amplitude = mix(sine(t) * 0.5, amplitude, clamp(cutoffFactor * 2.0, 0.0, 1.0));

  var env: f32 = 1.0;
  let attackEnd = params.attack * 0.5;
  let decayEnd = attackEnd + params.decay * 0.5;
  
  if (x < attackEnd) {
    env = x / attackEnd;
  } else if (x < decayEnd) {
    env = 1.0 - ((x - attackEnd) / (params.decay * 0.5)) * (1.0 - 0.5);
  } else {
    env = 0.5;
  }

  let y = amplitude * params.volume * env;
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

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex : u32) -> VertexOutput {
  let point = inputBuffer[vertexIndex];
  var output : VertexOutput;
  output.Position = vec4<f32>(point.position, 0.0, 1.0);
  output.color = vec4<f32>(0.2, 1.0, 0.8, 1.0);
  return output;
}

@fragment
fn fs_main(@location(0) color : vec4<f32>) -> @location(0) vec4<f32> {
  return color;
}
`;

export const useWebGPUScope = (canvasRef: React.RefObject<HTMLCanvasElement | null>, params: SynthParams, accentColor: 'cyan' | 'pink', initDelay: number = 0) => {
  const deviceRef = useRef<GPUDevice | null>(null);
  const pipelineRef = useRef<GPUComputePipeline | null>(null);
  const renderPipelineRef = useRef<GPURenderPipeline | null>(null);
  const uniformBufferRef = useRef<GPUBuffer | null>(null);
  const bindGroupRef = useRef<GPUBindGroup | null>(null);
  const startTimeRef = useRef<number>(Date.now());
  const requestRef = useRef<number>(0);
  const formattedDelay = useRef<number>(initDelay);

  // Keep a fresh reference to params so the loop can read them without restarting
  const paramsRef = useRef(params);
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: any;

    const init = async () => {
      if (!canvasRef.current || !navigator.gpu) return;

      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) throw new Error("No WebGPU adapter");
        const device = await adapter.requestDevice();
        if (cancelled) return;
        deviceRef.current = device;

        const context = canvasRef.current.getContext('webgpu');
        if (!context) throw new Error("No WebGPU context");
        const format = navigator.gpu.getPreferredCanvasFormat();
        context.configure({ device, format, alphaMode: 'premultiplied' });

        // Compile Shaders
        const computeModule = device.createShaderModule({ code: SHADER_CODE });
        const renderModule = device.createShaderModule({ code: VERTEX_FRAGMENT_SHADER });

        // Pipeline Setup
        const bindGroupLayout = device.createBindGroupLayout({
          entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.COMPUTE | GPUShaderStage.VERTEX, buffer: { type: 'storage' } },
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

        // Buffers
        uniformBufferRef.current = device.createBuffer({
          size: 32,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        const storageBuffer = device.createBuffer({
          size: 1024 * 2 * 4,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX,
        });

        bindGroupRef.current = device.createBindGroup({
          layout: bindGroupLayout,
          entries: [
            { binding: 0, resource: { buffer: uniformBufferRef.current } },
            { binding: 1, resource: { buffer: storageBuffer } },
          ],
        });

        // Start Loop
        const animate = () => {
          if (cancelled) return;
          renderFrame();
          requestRef.current = requestAnimationFrame(animate);
        };
        requestRef.current = requestAnimationFrame(animate);

      } catch (err) {
        console.error("WebGPU Init Failed:", err);
      }
    };

    const renderFrame = () => {
      const device = deviceRef.current;
      const context = canvasRef.current?.getContext('webgpu') as GPUCanvasContext;
      const uniformBuffer = uniformBufferRef.current;
      const bindGroup = bindGroupRef.current;
      const computePipeline = pipelineRef.current;
      const renderPipeline = renderPipelineRef.current;

      if (!device || !context || !uniformBuffer || !bindGroup || !computePipeline || !renderPipeline) return;

      // Read latest params from Ref
      const p = paramsRef.current;
      const waveMap: Record<string, number> = { 'sawtooth': 0, 'square': 1, 'triangle': 2, 'sine': 3 };
      const waveIndex = waveMap[p.waveform] ?? 0;
      const freq = noteToFrequency('C4') / 1000.0;
      const time = (Date.now() - startTimeRef.current) / 1000.0;

      const paramData = new Float32Array([
        0, // u32 placeholder
        freq,
        p.filterCutoff,
        p.filterResonance,
        p.attack,
        p.decay,
        p.volume,
        time
      ]);
      const uintView = new Uint32Array(paramData.buffer);
      uintView[0] = waveIndex;

      device.queue.writeBuffer(uniformBuffer, 0, paramData);

      const commandEncoder = device.createCommandEncoder();

      const computePass = commandEncoder.beginComputePass();
      computePass.setPipeline(computePipeline);
      computePass.setBindGroup(0, bindGroup);
      computePass.dispatchWorkgroups(Math.ceil(1024 / 64));
      computePass.end();

      const textureView = context.getCurrentTexture().createView();
      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: textureView,
          clearValue: { r: 0.05, g: 0.05, b: 0.07, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      renderPass.setPipeline(renderPipeline);
      renderPass.setBindGroup(0, bindGroup);
      renderPass.draw(1024);
      renderPass.end();

      device.queue.submit([commandEncoder.finish()]);
    };

    if (formattedDelay.current > 0) {
      timeoutId = setTimeout(init, formattedDelay.current);
    } else {
      init();
    }

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, []); // Run only once! Params are read via Ref.
};
