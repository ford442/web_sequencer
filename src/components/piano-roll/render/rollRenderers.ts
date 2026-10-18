/// <reference types="@webgpu/types" />
/**
 * Piano-roll renderers. Both draw a `RollScene` (quads in CSS pixels) plus
 * the per-frame playhead quad:
 *
 * - **WebGPU** — one instanced-quad pipeline on the shared device: the scene
 *   is one instance buffer, the playhead a second one-instance buffer, two
 *   draw calls per frame. Built by `createGpuRollRenderer` from inside a
 *   `startGpuCanvasSession`, so a lost device is replaced by a fresh pipeline.
 * - **Canvas2D** — the fallback when the probe fails: the same quads as
 *   `fillRect`s.
 */
import { canvasBufferSize, syncCanvasSize, type ConfiguredCanvas } from '@/webgpu/configureCanvas';
import type { RollLayout } from '../model/rollGeometry';
import { QUAD_FLOATS, type RollScene } from './rollScene';

export type RollBackend = 'webgpu' | 'canvas2d';

export interface RollFrame {
    scene: RollScene;
    playhead: Float32Array<ArrayBuffer> | null;
    layout: RollLayout;
}

export interface RollRenderer {
    readonly kind: RollBackend;
    draw(frame: RollFrame): void;
    dispose(): void;
}

const QUAD_BYTES = QUAD_FLOATS * 4;

export const ROLL_QUAD_WGSL = /* wgsl */ `
struct View { size: vec2f, pad: vec2f };
@group(0) @binding(0) var<uniform> view: View;

struct VsOut {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32, @location(0) rect: vec4f, @location(1) color: vec4f) -> VsOut {
  var corners = array<vec2f, 6>(
    vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
    vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0)
  );
  let px = rect.xy + corners[vi] * rect.zw;
  let ndc = vec2f(px.x / view.size.x * 2.0 - 1.0, 1.0 - px.y / view.size.y * 2.0);
  var out: VsOut;
  out.position = vec4f(ndc, 0.0, 1.0);
  // Premultiply once here; the blend state expects premultiplied colour.
  out.color = vec4f(color.rgb * color.a, color.a);
  return out;
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  return in.color;
}
`;

function nextCapacity(count: number): number {
    let n = 256;
    while (n < count) n *= 2;
    return n;
}

/** Build the instanced-quad pipeline for `surface` on `device`. */
export function createGpuRollRenderer(device: GPUDevice, surface: ConfiguredCanvas): RollRenderer {
    const module = device.createShaderModule({ label: 'piano-roll-quads', code: ROLL_QUAD_WGSL });
    const bindGroupLayout = device.createBindGroupLayout({
        label: 'piano-roll-view',
        entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }],
    });
    const instanceLayout: GPUVertexBufferLayout = {
        arrayStride: QUAD_BYTES,
        stepMode: 'instance',
        attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x4' },
            { shaderLocation: 1, offset: 16, format: 'float32x4' },
        ],
    };
    const blend: GPUBlendState = {
        color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    };
    const pipeline = device.createRenderPipeline({
        label: 'piano-roll-quads',
        layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        vertex: { module, entryPoint: 'vs', buffers: [instanceLayout] },
        fragment: { module, entryPoint: 'fs', targets: [{ format: surface.format, blend }] },
        primitive: { topology: 'triangle-list' },
    });

    const viewBuffer = device.createBuffer({
        label: 'piano-roll-view',
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const bindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [{ binding: 0, resource: { buffer: viewBuffer } }],
    });
    const playheadBuffer = device.createBuffer({
        label: 'piano-roll-playhead',
        size: QUAD_BYTES,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    let instanceBuffer: GPUBuffer | null = null;
    let capacity = 0;
    let uploaded: Float32Array<ArrayBuffer> | null = null;
    const viewData = new Float32Array(4);

    const ensureCapacity = (count: number) => {
        if (instanceBuffer && count <= capacity) return;
        instanceBuffer?.destroy();
        capacity = nextCapacity(count);
        instanceBuffer = device.createBuffer({
            label: 'piano-roll-scene',
            size: capacity * QUAD_BYTES,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        uploaded = null;
    };

    return {
        kind: 'webgpu',
        draw({ scene, playhead, layout }) {
            syncCanvasSize(surface);
            viewData[0] = Math.max(1, layout.width);
            viewData[1] = Math.max(1, layout.height);
            device.queue.writeBuffer(viewBuffer, 0, viewData);
            ensureCapacity(Math.max(1, scene.count));
            // Re-upload only when the scene object changed (playback frames reuse it).
            if (uploaded !== scene.quads && scene.count > 0) {
                device.queue.writeBuffer(instanceBuffer!, 0, scene.quads);
                uploaded = scene.quads;
            }
            if (playhead) device.queue.writeBuffer(playheadBuffer, 0, playhead);

            const encoder = device.createCommandEncoder({ label: 'piano-roll-frame' });
            const pass = encoder.beginRenderPass({
                colorAttachments: [{
                    view: surface.context.getCurrentTexture().createView(),
                    clearValue: { r: 0.02, g: 0.024, b: 0.03, a: 1 },
                    loadOp: 'clear',
                    storeOp: 'store',
                }],
            });
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, bindGroup);
            if (scene.count > 0) {
                pass.setVertexBuffer(0, instanceBuffer!);
                pass.draw(6, scene.count);
            }
            if (playhead) {
                pass.setVertexBuffer(0, playheadBuffer);
                pass.draw(6, 1);
            }
            pass.end();
            device.queue.submit([encoder.finish()]);
        },
        dispose() {
            instanceBuffer?.destroy();
            instanceBuffer = null;
            viewBuffer.destroy();
            playheadBuffer.destroy();
        },
    };
}

const colorCache = new Map<number, string>();

function cssColor(r: number, g: number, b: number, a: number): string {
    const ri = Math.round(r * 255);
    const gi = Math.round(g * 255);
    const bi = Math.round(b * 255);
    const ai = Math.round(a * 100);
    const key = ((ri * 256 + gi) * 256 + bi) * 128 + ai;
    let s = colorCache.get(key);
    if (!s) {
        s = `rgba(${ri},${gi},${bi},${ai / 100})`;
        if (colorCache.size > 4096) colorCache.clear();
        colorCache.set(key, s);
    }
    return s;
}

/** The fallback: same quads, drawn with `fillRect`. Null when the canvas has no 2D context. */
export function createCanvas2dRollRenderer(canvas: HTMLCanvasElement): RollRenderer | null {
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const fillQuads = (data: Float32Array, count: number) => {
        for (let i = 0; i < count; i++) {
            const o = i * QUAD_FLOATS;
            ctx.fillStyle = cssColor(data[o + 4], data[o + 5], data[o + 6], data[o + 7]);
            ctx.fillRect(data[o], data[o + 1], data[o + 2], data[o + 3]);
        }
    };
    return {
        kind: 'canvas2d',
        draw({ scene, playhead, layout }) {
            const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
            const { w, h } = canvasBufferSize(canvas, dpr);
            if (canvas.width !== w) canvas.width = w;
            if (canvas.height !== h) canvas.height = h;
            ctx.setTransform(w / Math.max(1, layout.width), 0, 0, h / Math.max(1, layout.height), 0, 0);
            ctx.fillStyle = '#05060a';
            ctx.fillRect(0, 0, layout.width, layout.height);
            fillQuads(scene.quads, scene.count);
            if (playhead) fillQuads(playhead, 1);
        },
        dispose() {
            /* nothing held beyond the context */
        },
    };
}
