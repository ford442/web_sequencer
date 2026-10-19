import { useEffect, useRef } from 'react';
import { engineDegradationStore } from '../../stores/engineDegradationStore';
import { startGpuCanvasSession, type GpuCanvasSession } from '../../webgpu/gpuCanvasSession';
import { syncCanvasSize, type ConfiguredCanvas } from '../../webgpu/configureCanvas';
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

const WORKGROUP_SIZE = 64;
const NUM_POINTS = 1024;
const MAX_INPUT_POINTS = 256;
const CURVE_COLOR = new Float32Array([0.0, 0.898, 1.0, 1.0]); // cyan-400

interface CurveInputs {
  points: AutomationLanePoint[];
  interpolation: string;
  totalSteps: number;
}

function createCurveSession(
  device: GPUDevice,
  surface: ConfiguredCanvas,
  inputsRef: React.MutableRefObject<CurveInputs>,
): GpuCanvasSession {
  const computeModule = device.createShaderModule({ label: 'curve-editor-compute', code: COMPUTE_SHADER_CODE });
  const renderModule = device.createShaderModule({ label: 'curve-editor-render', code: VERTEX_FRAGMENT_SHADER });

  // Separate layouts that match each shader: compute reads the lane points
  // (1) and writes the curve (2); render reads that curve as read-only
  // storage at 1 (a writable storage binding may not be vertex-visible) and
  // the colour at 2.
  const computeLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const renderLayout = device.createBindGroupLayout({
    entries: [
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
    ],
  });

  const computePipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [computeLayout] }),
    compute: { module: computeModule, entryPoint: 'main' },
  });

  const renderPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [renderLayout] }),
    vertex: { module: renderModule, entryPoint: 'vs_main' },
    fragment: { module: renderModule, entryPoint: 'fs_main', targets: [{ format: surface.format }] },
    primitive: { topology: 'line-strip' },
  });

  const uniformBuffer = device.createBuffer({
    size: 16, // 4 u32s
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const pointsBuffer = device.createBuffer({
    size: MAX_INPUT_POINTS * 4 * 4, // 256 points * 4 floats/u32s * 4 bytes
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  const storageBuffer = device.createBuffer({
    size: NUM_POINTS * 2 * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX,
  });

  const accentColorBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(accentColorBuffer, 0, CURVE_COLOR);

  const computeBindGroup = device.createBindGroup({
    layout: computeLayout,
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: pointsBuffer } },
      { binding: 2, resource: { buffer: storageBuffer } },
    ],
  });
  const renderBindGroup = device.createBindGroup({
    layout: renderLayout,
    entries: [
      { binding: 1, resource: { buffer: storageBuffer } },
      { binding: 2, resource: { buffer: accentColorBuffer } },
    ],
  });

  const uniformData = new Uint32Array(4);
  const uniformDataFloat = new Float32Array(uniformData.buffer);
  const pointsData = new Float32Array(MAX_INPUT_POINTS * 4);
  const pointsDataUint = new Uint32Array(pointsData.buffer);
  let animationFrameId = 0;
  let disposed = false;

  const renderFrame = () => {
    if (disposed) return;
    const { points: currentPoints, interpolation: currentInterp, totalSteps: currentTotalSteps } = inputsRef.current;

    let interpMode = 0;
    if (currentInterp === 'linear') interpMode = 1;
    else if (currentInterp === 'smooth') interpMode = 2;

    const count = Math.min(currentPoints.length, MAX_INPUT_POINTS);
    uniformData[0] = count;
    uniformData[1] = interpMode;
    uniformDataFloat[2] = currentTotalSteps;
    device.queue.writeBuffer(uniformBuffer, 0, uniformData);

    for (let i = 0; i < count; i++) {
      const p = currentPoints[i];
      pointsData[i * 4] = p.step;
      pointsData[i * 4 + 1] = p.value;
      pointsDataUint[i * 4 + 2] = p.accent ? 1 : 0;
      pointsDataUint[i * 4 + 3] = p.slide ? 1 : 0;
    }
    device.queue.writeBuffer(pointsBuffer, 0, pointsData);

    syncCanvasSize(surface);
    const commandEncoder = device.createCommandEncoder();

    const computePass = commandEncoder.beginComputePass();
    computePass.setPipeline(computePipeline);
    computePass.setBindGroup(0, computeBindGroup);
    computePass.dispatchWorkgroups(Math.ceil(NUM_POINTS / WORKGROUP_SIZE));
    computePass.end();

    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: surface.context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    renderPass.setPipeline(renderPipeline);
    renderPass.setBindGroup(0, renderBindGroup);
    renderPass.draw(NUM_POINTS);
    renderPass.end();
    device.queue.submit([commandEncoder.finish()]);

    animationFrameId = requestAnimationFrame(renderFrame);
  };

  renderFrame();

  return {
    dispose() {
      disposed = true;
      cancelAnimationFrame(animationFrameId);
      uniformBuffer.destroy();
      pointsBuffer.destroy();
      storageBuffer.destroy();
      accentColorBuffer.destroy();
    },
  };
}

export const useWebGPUCurveEditor = (
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  points: AutomationLanePoint[],
  interpolation: string,
  totalSteps: number,
  width: number,
  height: number
) => {
  const inputsRef = useRef<CurveInputs>({ points, interpolation, totalSteps });

  useEffect(() => {
    inputsRef.current = { points, interpolation, totalSteps };
  }, [points, interpolation, totalSteps]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return startGpuCanvasSession(canvas, {
      // Drawn over the SVG grid: the clear must stay transparent.
      alphaMode: 'premultiplied',
      create: (device, surface) => createCurveSession(device, surface, inputsRef),
      onActive: () => engineDegradationStore.resolve('webgpu-curve-editor'),
      onUnavailable: (reason) => {
        engineDegradationStore.report({
          id: 'webgpu-curve-editor',
          subsystem: 'webgpu-curve-editor',
          category: 'gpu',
          message: 'Curve Editor using SVG fallback',
          reason,
          status: 'active',
          activeBackend: 'static',
          requestedBackend: 'webgpu',
          retryable: false,
        });
      },
    });
  }, [canvasRef]);
};
