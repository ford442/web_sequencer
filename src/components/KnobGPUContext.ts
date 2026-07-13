export interface SlotHandle {
    id: number;
}

interface Slot {
    canvas: HTMLCanvasElement;
    context: GPUCanvasContext;
    getValue: () => number;
    uniformBuffer: GPUBuffer;
    bindGroup: GPUBindGroup;
    width: number;
    height: number;
}

import { KNOB_MATERIAL, rgbToWgsl, resolveTickPositions, resolveDetentPositions, tickAnglesToWgslArray, tickMajorFlagsToWgslArray, detentAnglesToWgslArray, usesHardwarePointer } from './knobMaterial';
import type { KnobMaterial } from './knobMaterial';
import { engineDegradationStore } from '../stores/engineDegradationStore';
import { loadingProgressStore } from '../stores/loadingProgressStore';

export type KnobGpuStatus = 'unavailable' | 'initializing' | 'active' | 'degraded' | 'recovering';

type StatusListener = (status: KnobGpuStatus) => void;

// --- HOLOGRAPHIC SHADER ---
// Features: Scanlines, Rim Glow, Data Ring, "Projected" floating feel
// Material values are baked in at module load time via string interpolation so
// the existing per-knob uniform buffer (time, value, resolution) does not need
// to grow.  This keeps the buffer at 4 floats (32 bytes) and avoids re-creating
// the shader module per knob.
export function buildKnobShaderCode(material: KnobMaterial = KNOB_MATERIAL): string {
    const tickAngles = tickAnglesToWgslArray(material);
    const tickMajorFlags = tickMajorFlagsToWgslArray(material);
    const tickCount = resolveTickPositions(material).length;
    const detentAngles = detentAnglesToWgslArray(material);
    const detentCount = resolveDetentPositions(material).length;
    const minorHalfLen = ((material.scale?.tickLength ?? 0.06) * 0.5).toFixed(4);
    const majorHalfLen = ((material.scale?.majorTickLength ?? 0.09) * 0.5).toFixed(4);
    const dimpleDepth = ((material.detents?.dimpleDepth ?? 0.045) * 0.5).toFixed(4);
    const dimpleAngle = (material.detents?.dimpleAngle ?? 0.055).toFixed(4);
    const hardwarePointer = usesHardwarePointer(material);
    const pointerBase = material.pointer?.base ?? material.palette.needle;
    const pointerSpec = material.pointer?.specular ?? material.palette.needle;
    const pointerShadow = material.pointer?.shadow ?? { r: 0.05, g: 0.08, b: 0.12 };
    const detentShadow = material.palette.detentShadow ?? { r: 0.0, g: 0.15, b: 0.2 };

    return `
    struct Uniforms {
      time: f32,
      value: f32,
      resolution: vec2f,
    };
    @group(0) @binding(0) var<uniform> u: Uniforms;

    struct VertexOutput {
      @builtin(position) position: vec4f,
      @location(0) uv: vec2f,
    };

    @vertex
    fn vs_main(@builtin(vertex_index) vIdx: u32) -> VertexOutput {
      // Full screen triangle
      var pos = array<vec2f, 3>(
        vec2f(-1.0, -1.0),
        vec2f(3.0, -1.0),
        vec2f(-1.0, 3.0)
      );
      var output: VertexOutput;
      output.position = vec4f(pos[vIdx], 0.0, 1.0);
      output.uv = pos[vIdx]; // UVs are -1 to 1 effectively for the quad
      return output;
    }

    // Helper: Circle SDF
    fn sdCircle(p: vec2f, r: f32) -> f32 {
        return length(p) - r;
    }
    
    // Helper: Rotation Matrix
    fn rotate(angle: f32) -> mat2x2f {
        let c = cos(angle);
        let s = sin(angle);
        return mat2x2f(c, -s, s, c);
    }

    @fragment
    fn fs_main(in: VertexOutput) -> @location(0) vec4f {
      var uv = in.uv;
      // Center UVs properly assuming canvas is square-ish
      // Standardize coordinate system to -1.0 to 1.0
      
      let len = length(uv);
      let angle = atan2(uv.y, uv.x);
      
      // Base Color (Cyan/Teal Hologram)
      var color = ${rgbToWgsl(material.palette.ring)};
      var alpha = 0.0;

      // 1. Outer Data Ring
      // Rotating dashed ring
      let rot_uv = rotate(u.time * 0.2) * uv;
      let ring_dist = abs(length(rot_uv) - ${(material.geometry.outerRingRadius * 0.5).toFixed(4)});
      let dash = sin(atan2(rot_uv.y, rot_uv.x) * 20.0);
      if (ring_dist < 0.02 && dash > 0.5) {
          alpha += 0.6 * smoothstep(0.02, 0.0, ring_dist);
      }

      // 2. Value Arc (The "Level" Indicator)
      // Map value 0..1 to angle range [-max_angle, +max_angle]
      // Knob starts at bottom-left, sweeps clockwise to bottom-right.
      let max_angle = ${(material.geometry.sweepTotal / 2.0).toFixed(4)};
      let val_mapped = mix(-max_angle, max_angle, u.value);

      // Needle direction: rotate standard "up" (+Y) by val_mapped
      let needle_vec = vec2f(sin(val_mapped), cos(val_mapped));

      // Value arc: light the inner ring where the pixel angle <= val_mapped
      // atan2 gives [-\u03c0, \u03c0]; we shift so 0 = straight up (matches needle_vec above)
      let pixel_angle = atan2(uv.x, uv.y); // note: swapped args for "up = 0" convention
      let arc_radius = ${(material.geometry.arcRadius * 0.5).toFixed(4)};
      let arc_dist = abs(length(uv) - arc_radius);
      // Only draw arc within the \u00b1max_angle sweep and up to the current value
      if (arc_dist < 0.03 && pixel_angle >= -max_angle && pixel_angle <= val_mapped) {
          let arc_brightness = smoothstep(0.03, 0.0, arc_dist);
          // Color shifts from teal at min to bright cyan at current value
          let arc_t = (pixel_angle + max_angle) / (val_mapped + max_angle + 0.001);
          color = mix(${rgbToWgsl(material.palette.arcMin)}, ${rgbToWgsl(material.palette.arcMax)}, arc_t);
          alpha += arc_brightness * 0.85;
      }

      // 2b. Scale ticks along the value arc (hardware-style position reference)
      let tick_angles = ${tickAngles};
      let tick_major = ${tickMajorFlags};
      let tick_count = ${tickCount}u;
      for (var ti = 0u; ti < tick_count; ti++) {
          let ta = tick_angles[ti];
          let angle_diff = abs(pixel_angle - ta);
          let half_len = mix(${minorHalfLen}, ${majorHalfLen}, tick_major[ti]);
          let tick_inner = arc_radius - half_len;
          let tick_outer = arc_radius + half_len;
          let r = length(uv);
          let tick_color = mix(${rgbToWgsl(material.palette.scaleMinor)}, ${rgbToWgsl(material.palette.scaleMajor)}, tick_major[ti]);
          if (r >= tick_inner && r <= tick_outer && angle_diff < 0.035 && pixel_angle >= -max_angle && pixel_angle <= max_angle) {
              let tick_brightness = smoothstep(0.035, 0.0, angle_diff) * mix(0.55, 0.95, tick_major[ti]);
              color = tick_color;
              alpha += tick_brightness;
          }
      }

      // 2c. Detent dimples (recessed hardware notches at major landmarks)
      let detent_angles = ${detentAngles};
      let detent_count = ${detentCount}u;
      let detent_shadow = ${rgbToWgsl(detentShadow)};
      for (var di = 0u; di < detent_count; di++) {
          let da = detent_angles[di];
          let detent_diff = abs(pixel_angle - da);
          let r = length(uv);
          let notch_inner = arc_radius - ${dimpleDepth};
          let notch_outer = arc_radius + ${dimpleDepth} * 0.65;
          if (detent_diff < ${dimpleAngle} && r >= notch_inner && r <= notch_outer && pixel_angle >= -max_angle && pixel_angle <= max_angle) {
              let dimple = smoothstep(${dimpleAngle}, 0.0, detent_diff)
                  * smoothstep(notch_outer, arc_radius, r)
                  * smoothstep(notch_inner, arc_radius, r);
              color = mix(color, detent_shadow, dimple * 0.85);
              alpha += dimple * 0.55;
          }
      }

      // 3. Holographic Scanlines
      let scanline = sin(uv.y * 150.0 + u.time * 10.0) * 0.5 + 0.5;

      // 4. Central Glow / "Projector" beam
      let beam = smoothstep(0.6, 0.0, len);

      // Compose the "Ghost" Knob
      var final_c = vec3f(0.0);

      // Main Circle Body
      let circle_edge = 1.0 - smoothstep(0.48, 0.5, len);
      let inner_glow = smoothstep(0.0, 0.5, len);
      alpha += circle_edge * 0.2 * scanline; // Background body

      // The Needle — hardware-lit variant or legacy glow
      let proj = dot(uv, needle_vec);
      let perp = length(uv - needle_vec * proj);
      let needle_len = ${(material.geometry.needleLength * 0.5).toFixed(4)};
      ${hardwarePointer ? `
      let needle_half_w = 0.018;
      if (proj > 0.02 && proj < needle_len && perp < needle_half_w) {
          let along = proj / needle_len;
          let body = mix(${rgbToWgsl(pointerShadow)}, ${rgbToWgsl(pointerBase)}, smoothstep(0.0, 1.0, along));
          let specular = exp(-pow((along - 0.68) / 0.11, 2.0))
              * exp(-pow(perp / (needle_half_w * 0.35), 2.0));
          color = mix(body, ${rgbToWgsl(pointerSpec)}, specular * 0.95);
          alpha += smoothstep(needle_half_w, 0.0, perp) * 0.95;
      }
      // Cast shadow opposite the needle on the knob face
      let shadow_vec = -needle_vec;
      let shadow_proj = dot(uv, shadow_vec);
      let shadow_perp = length(uv - shadow_vec * shadow_proj);
      if (shadow_proj > 0.02 && shadow_proj < 0.14 && shadow_perp < 0.07) {
          let shadow_a = smoothstep(0.14, 0.02, shadow_proj) * smoothstep(0.07, 0.0, shadow_perp) * 0.35;
          color = mix(color, ${rgbToWgsl(pointerShadow)}, shadow_a);
          alpha += shadow_a * 0.4;
      }
      ` : `
      if (proj > 0.0 && proj < needle_len && perp < 0.02 && perp > 0.0005) {
          alpha += min(1.0 / (perp * 100.0), 8.0);
          color = ${rgbToWgsl(material.palette.needle)};
      }
      `}

      // 5. Fresnel / Glitch Effect
      let glitch = step(0.98, sin(u.time * 20.0 + uv.y * 10.0));
      if (glitch > 0.5) {
          uv.x += 0.05;
          alpha += 0.2;
      }

      // Vignette / Falloff at edges of canvas
      alpha *= smoothstep(0.8, 0.6, len);

      return vec4f(color * alpha * ${material.bloom.intensity.toFixed(4)}, alpha);
    }
`;
}

const SHADER_CODE = buildKnobShaderCode();

class KnobGPUContextClass {
    private device: GPUDevice | null = null;
    private pipeline: GPURenderPipeline | null = null;
    private format: GPUTextureFormat | null = null;
    private slots = new Map<number, Slot>();
    private registrations = new Map<number, { canvas: HTMLCanvasElement; getValue: () => number }>();
    private pendingIds = new Set<number>();
    private nextId = 1;
    private rafId: number | null = null;
    private initPromise: Promise<boolean> | null = null;
    private status: KnobGpuStatus = 'unavailable';
    private statusListeners = new Set<StatusListener>();
    private consecutiveRenderFailures = 0;
    private recoverScheduled = false;
    private deviceLostHandled = false;

    getStatus(): KnobGpuStatus {
        return this.status;
    }

    isSlotActive(handle: SlotHandle | null): boolean {
        if (!handle) return false;
        return this.slots.has(handle.id);
    }

    onStatusChange(listener: StatusListener): () => void {
        this.statusListeners.add(listener);
        listener(this.status);
        return () => this.statusListeners.delete(listener);
    }

    private setStatus(next: KnobGpuStatus): void {
        if (this.status === next) return;
        this.status = next;
        this.statusListeners.forEach((l) => l(next));
    }

    private reportDegradation(reason: string, recovering = false): void {
        engineDegradationStore.report({
            id: 'gpu-knobs',
            subsystem: 'gpu-knobs',
            category: 'gpu',
            message: recovering ? 'GPU knobs recovering…' : 'GPU knobs using 2D fallback',
            reason,
            status: recovering ? 'recovering' : 'active',
            activeBackend: recovering ? 'webgpu-retry' : 'canvas-2d',
            requestedBackend: 'webgpu',
            retryable: true,
        });
    }

    private resolveDegradation(): void {
        engineDegradationStore.resolve('gpu-knobs');
        loadingProgressStore.clearRuntimeDegradation('gpu-knobs');
    }

    register(canvas: HTMLCanvasElement, getValue: () => number): SlotHandle | null {
        if (!navigator.gpu) {
            this.setStatus('unavailable');
            this.reportDegradation('navigator.gpu unavailable');
            return null;
        }

        const id = this.nextId++;
        this.registrations.set(id, { canvas, getValue });
        this.pendingIds.add(id);
        this.setStatus('initializing');

        this.ensureInit().then((success) => {
            if (!this.pendingIds.has(id) && !this.registrations.has(id)) return;
            this.pendingIds.delete(id);

            if (!success || !this.device || !this.pipeline || !this.format) {
                this.setStatus('degraded');
                return;
            }

            if (this.attachSlot(id, canvas, getValue)) {
                this.setStatus('active');
                this.resolveDegradation();
                this.consecutiveRenderFailures = 0;
            }
        });

        return { id };
    }

    private attachSlot(id: number, canvas: HTMLCanvasElement, getValue: () => number): boolean {
        if (!this.device || !this.pipeline || !this.format) return false;
        try {
            const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
            if (!context) return false;

            context.configure({
                device: this.device,
                format: this.format,
                alphaMode: 'premultiplied',
            });

            const uniformBuffer = this.device.createBuffer({
                size: 32,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });

            const bindGroup = this.device.createBindGroup({
                layout: this.pipeline.getBindGroupLayout(0),
                entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
            });

            this.slots.set(id, {
                canvas,
                context,
                getValue,
                uniformBuffer,
                bindGroup,
                width: canvas.width,
                height: canvas.height,
            });

            this.startRAF();
            return true;
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            this.reportDegradation(`slot attach failed: ${reason}`);
            return false;
        }
    }

    unregister(handle: SlotHandle | null): void {
        if (!handle) return;

        this.pendingIds.delete(handle.id);
        this.registrations.delete(handle.id);

        const slot = this.slots.get(handle.id);
        if (slot) {
            if (slot.uniformBuffer && typeof slot.uniformBuffer.destroy === 'function') {
                slot.uniformBuffer.destroy();
            }
            this.slots.delete(handle.id);
        }

        if (this.slots.size === 0 && this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }

    async retryInit(): Promise<boolean> {
        this.setStatus('recovering');
        this.reportDegradation('manual retry requested', true);
        this.teardownDevice();
        this.consecutiveRenderFailures = 0;
        this.recoverScheduled = false;
        this.deviceLostHandled = false;
        this.initPromise = null;

        const ok = await this.ensureInit();
        if (!ok) {
            this.setStatus('degraded');
            this.reportDegradation('retry failed');
            return false;
        }

        let attached = 0;
        for (const [id, reg] of this.registrations) {
            if (this.attachSlot(id, reg.canvas, reg.getValue)) attached++;
        }

        if (attached > 0) {
            this.setStatus('active');
            this.resolveDegradation();
            return true;
        }

        this.setStatus('degraded');
        this.reportDegradation('retry succeeded but no slots attached');
        return false;
    }

    private teardownDevice(): void {
        for (const slot of this.slots.values()) {
            try {
                slot.uniformBuffer?.destroy?.();
            } catch { /* noop */ }
        }
        this.slots.clear();
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        try {
            this.device?.destroy?.();
        } catch { /* noop */ }
        this.device = null;
        this.pipeline = null;
        this.format = null;
    }

    private scheduleRecovery(reason: string): void {
        if (this.recoverScheduled) return;
        this.recoverScheduled = true;
        this.setStatus('degraded');
        this.reportDegradation(reason);
        window.setTimeout(() => {
            this.recoverScheduled = false;
            void this.retryInit();
        }, 1200);
    }

    private async ensureInit(): Promise<boolean> {
        if (this.device) return true;
        if (this.initPromise) return this.initPromise;

        this.initPromise = this.doInit();
        return this.initPromise;
    }

    private async doInit(): Promise<boolean> {
        if (!navigator.gpu) {
            this.setStatus('unavailable');
            this.reportDegradation('navigator.gpu unavailable');
            return false;
        }
        try {
            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) {
                this.setStatus('degraded');
                this.reportDegradation('requestAdapter() returned null');
                return false;
            }
            const device = await adapter.requestDevice();
            this.device = device;
            this.format = navigator.gpu.getPreferredCanvasFormat();

            if (!this.deviceLostHandled) {
                this.deviceLostHandled = true;
                void device.lost.then((info) => {
                    const reason = info.message || 'GPU device lost';
                    this.teardownDevice();
                    this.initPromise = null;
                    this.deviceLostHandled = false;
                    this.scheduleRecovery(reason);
                });
            }

            const shaderModule = this.device.createShaderModule({ code: SHADER_CODE });
            this.pipeline = this.device.createRenderPipeline({
                layout: 'auto',
                vertex: { module: shaderModule, entryPoint: 'vs_main' },
                fragment: {
                    module: shaderModule,
                    entryPoint: 'fs_main',
                    targets: [{ format: this.format }],
                },
                primitive: { topology: 'triangle-list' },
            });

            return true;
        } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            this.setStatus('degraded');
            this.reportDegradation(`WebGPU init failed: ${reason}`);
            return false;
        }
    }

    private startRAF(): void {
        if (this.rafId !== null) return;
        const loop = () => {
            this.renderAll();
            this.rafId = requestAnimationFrame(loop);
        };
        this.rafId = requestAnimationFrame(loop);
    }

    private renderAll(): void {
        if (!this.device || !this.pipeline || this.slots.size === 0) return;

        const encoder = this.device.createCommandEncoder();
        const now = performance.now() / 1000;
        let hasPass = false;
        let frameFailures = 0;

        for (const slot of this.slots.values()) {
            try {
                const value = slot.getValue();
                const uniforms = new Float32Array([now, value, slot.width, slot.height]);
                this.device.queue.writeBuffer(slot.uniformBuffer, 0, uniforms);

                const pass = encoder.beginRenderPass({
                    colorAttachments: [{
                        view: slot.context.getCurrentTexture().createView(),
                        loadOp: 'clear',
                        clearValue: { r: 0, g: 0, b: 0, a: 0 },
                        storeOp: 'store',
                    }],
                });

                pass.setPipeline(this.pipeline);
                pass.setBindGroup(0, slot.bindGroup);
                pass.draw(3);
                pass.end();
                hasPass = true;
            } catch {
                frameFailures++;
            }
        }

        if (hasPass) {
            try {
                this.device.queue.submit([encoder.finish()]);
                this.consecutiveRenderFailures = 0;
            } catch {
                frameFailures++;
            }
        }

        if (frameFailures > 0) {
            this.consecutiveRenderFailures += frameFailures;
            if (this.consecutiveRenderFailures >= 3) {
                this.scheduleRecovery(`${this.consecutiveRenderFailures} consecutive render failures`);
            }
        }
    }
}

export const KnobGPUContext = new KnobGPUContextClass();

engineDegradationStore.registerRetryHandler('gpu-knobs', () => {
    void KnobGPUContext.retryInit();
});
