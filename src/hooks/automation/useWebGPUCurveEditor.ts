import { useEffect, useRef } from 'react';
import { engineDegradationStore } from '../../stores/engineDegradationStore';
import { probeWebGPU } from '../../engines/backends/webgpuProbe';
import type { AutomationLanePoint } from '../../types';

// The compute shader takes the list of points and interpolation mode,
// and outputs the y values for the line strip.
const COMPUTE_SHADER_CODE = `
struct Params {
  pointCount: u32,
  interpolation: u32, // 0: step, 1: linear, 2: smooth
  totalSteps: f32,
  padding: f32,
}

struct Point {
  step: f32,
  value: f32,
  accent: u32,
  slide: u32,
}

struct OutputPoint {
  position: vec2<f32>,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> pointsBuffer: array<Point>;
@group(0) @binding(2) var<storage, read_write> outputBuffer: array<OutputPoint>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let index = global_id.x;
  let totalOutputPoints = 1024u;

  if (index >= totalOutputPoints) { return; }

  let xNormalized = f32(index) / f32(totalOutputPoints - 1u);
  let stepPosition = xNormalized * params.totalSteps;

  var y = 0.0;

  if (params.pointCount > 0u) {
    var p0 = pointsBuffer[0];
    if (stepPosition <= p0.step) {
      y = p0.value;
    } else {
      var found = false;
      for (var i = 1u; i < params.pointCount; i++) {
        let p1 = pointsBuffer[i];
        if (stepPosition <= p1.step) {
           p0 = pointsBuffer[i - 1u];
           if (params.interpolation == 0u) {
             y = p0.value;
           } else if (params.interpolation == 1u) {
             let t = (stepPosition - p0.step) / (p1.step - p0.step);
             y = mix(p0.value, p1.value, t);
           } else if (params.interpolation == 2u) {
             let t = (stepPosition - p0.step) / (p1.step - p0.step);
             let smoothT = t * t * (3.0 - 2.0 * t);
             y = mix(p0.value, p1.value, smoothT);
           }
           found = true;
           break;
        }
      }
      if (!found) {
        y = pointsBuffer[params.pointCount - 1u].value;
      }
    }
  }

  // Write to Storage Buffer
  // X range: -1 to 1, Y range: -1 to 1
  outputBuffer[index].position = vec2<f32>(xNormalized * 2.0 - 1.0, y * 2.0 - 1.0);
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
  output.Position = vec4<f32>(point.position.x, point.position.y, 0.0, 1.0);
  output.color = accentColor;
  return output;
}

@fragment
fn fs_main(@location(0) color : vec4<f32>) -> @location(0) vec4<f32> {
  return color;
}
`;

export const useWebGPUCurveEditor = (
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  points: AutomationLanePoint[],
  interpolation: string,
  totalSteps: number,
  width: number,
  height: number
) => {
  const deviceRef = useRef<GPUDevice | null>(null);
  const pipelineRef = useRef<GPUComputePipeline | null>(null);
  const renderPipelineRef = useRef<GPURenderPipeline | null>(null);
  const uniformBufferRef = useRef<GPUBuffer | null>(null);
  const pointsBufferRef = useRef<GPUBuffer | null>(null);
  const storageBufferRef = useRef<GPUBuffer | null>(null);
  const accentColorBufferRef = useRef<GPUBuffer | null>(null);
  const bindGroupRef = useRef<GPUBindGroup | null>(null);

  const pointsRef = useRef(points);
  const interpolationRef = useRef(interpolation);
  const totalStepsRef = useRef(totalSteps);

  const WORKGROUP_SIZE = 64;
  const NUM_POINTS = 1024;
  const MAX_INPUT_POINTS = 256;

  useEffect(() => {
    pointsRef.current = points;
    interpolationRef.current = interpolation;
    totalStepsRef.current = totalSteps;
  }, [points, interpolation, totalSteps]);

  useEffect(() => {
    let isCleanedUp = false;

    const initWebGPU = async () => {
      if (!canvasRef.current) return;

      const probe = await probeWebGPU();
      if (!probe.ok || !probe.device || isCleanedUp) {
        if (!probe.ok) {
          engineDegradationStore.report({
            id: 'webgpu-curve-editor',
            subsystem: 'webgpu-curve-editor',
            category: 'gpu',
            message: 'Curve Editor using SVG fallback',
            reason: probe.reason ?? 'WebGPU unavailable',
            status: 'active',
            activeBackend: 'static',
            requestedBackend: 'webgpu',
            retryable: false,
          });
        }
        return;
      }

      const device = probe.device;
      deviceRef.current = device;

      const context = canvasRef.current.getContext('webgpu') as GPUCanvasContext | null;
      if (!context) return;

      const format = navigator.gpu?.getPreferredCanvasFormat?.() ?? 'bgra8unorm';
      context.configure({ device, format });

      const computeModule = device.createShaderModule({ code: COMPUTE_SHADER_CODE });
      const renderModule = device.createShaderModule({ code: VERTEX_FRAGMENT_SHADER });

      const bindGroupLayout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
          { binding: 2, visibility: GPUShaderStage.COMPUTE | GPUShaderStage.VERTEX, buffer: { type: 'storage' } },
          { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
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

      uniformBufferRef.current = device.createBuffer({
        size: 16, // 4 u32s
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      pointsBufferRef.current = device.createBuffer({
        size: MAX_INPUT_POINTS * 4 * 4, // 256 points * 4 floats/u32s * 4 bytes
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });

      storageBufferRef.current = device.createBuffer({
        size: NUM_POINTS * 2 * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX,
      });

      accentColorBufferRef.current = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      bindGroupRef.current = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: uniformBufferRef.current } },
          { binding: 1, resource: { buffer: pointsBufferRef.current } },
          { binding: 2, resource: { buffer: storageBufferRef.current } },
          { binding: 3, resource: { buffer: accentColorBufferRef.current } },
        ],
      });

      let animationFrameId: number;

      const renderFrame = () => {
        if (isCleanedUp || !deviceRef.current) return;
        const device = deviceRef.current;
        const currentPoints = pointsRef.current;
        const currentInterp = interpolationRef.current;
        const currentTotalSteps = totalStepsRef.current;

        let interpMode = 0;
        if (currentInterp === 'linear') interpMode = 1;
        else if (currentInterp === 'smooth') interpMode = 2;

        const uniformData = new Uint32Array(4);
        uniformData[0] = Math.min(currentPoints.length, MAX_INPUT_POINTS);
        uniformData[1] = interpMode;
        const uniformDataFloat = new Float32Array(uniformData.buffer);
        uniformDataFloat[2] = currentTotalSteps;

        device.queue.writeBuffer(uniformBufferRef.current!, 0, uniformData);

        const pointsData = new Float32Array(MAX_INPUT_POINTS * 4);
        const pointsDataUint = new Uint32Array(pointsData.buffer);

        for (let i = 0; i < Math.min(currentPoints.length, MAX_INPUT_POINTS); i++) {
          const p = currentPoints[i];
          pointsData[i * 4] = p.step;
          pointsData[i * 4 + 1] = p.value;
          pointsDataUint[i * 4 + 2] = p.accent ? 1 : 0;
          pointsDataUint[i * 4 + 3] = p.slide ? 1 : 0;
        }

        device.queue.writeBuffer(pointsBufferRef.current!, 0, pointsData);

        // Update accent color
        const colorData = new Float32Array([0.0, 0.898, 1.0, 1.0]); // cyan-400
        device.queue.writeBuffer(accentColorBufferRef.current!, 0, colorData);

        const commandEncoder = device.createCommandEncoder();

        const computePass = commandEncoder.beginComputePass();
        computePass.setPipeline(pipelineRef.current!);
        computePass.setBindGroup(0, bindGroupRef.current!);
        computePass.dispatchWorkgroups(Math.ceil(NUM_POINTS / WORKGROUP_SIZE));
        computePass.end();

        const context = canvasRef.current!.getContext('webgpu') as GPUCanvasContext | null;
        if (context) {
            const textureView = context.getCurrentTexture().createView();
            const renderPass = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: textureView,
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
                loadOp: 'clear',
                storeOp: 'store',
            }],
            });

            renderPass.setPipeline(renderPipelineRef.current!);
            renderPass.setBindGroup(0, bindGroupRef.current!);
            renderPass.draw(NUM_POINTS);
            renderPass.end();
            device.queue.submit([commandEncoder.finish()]);
        }

        animationFrameId = requestAnimationFrame(renderFrame);
      };

      renderFrame();

      return () => {
         cancelAnimationFrame(animationFrameId);
      }
    };

    const cleanupPromise = initWebGPU();

    return () => {
      isCleanedUp = true;
      deviceRef.current = null;
    };
  }, [canvasRef]);
};
