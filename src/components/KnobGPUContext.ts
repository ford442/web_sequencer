/**
 * Shared holographic-knob GPU context.
 *
 * Ceiling note: a texture-atlas / single-canvas approach would make active GPU
 * cost fully independent of N, but moves layout/z-order/scroll/drag-hit-testing/a11y
 * out of the DOM. Deferred — not worth it for quads + a bloom pass. This module
 * keeps per-knob canvases and collapses cost via dirty-tracking + idle-static
 * material (time uniform locked when not actively interacting).
 *
 * React integration: `subscribe` / `getSnapshot` are useSyncExternalStore-compatible
 * for pause/status. `markDirty` mutates the dirty-set only and does NOT notify
 * React subscribers — the rAF loop reads the store/refs directly.
 */

export type KnobGpuStatus = 'unavailable' | 'initializing' | 'active' | 'degraded' | 'recovering';

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
    dirty: boolean;
    /** Drag / hover / keyboard-focus — only this knob advances the time uniform. */
    animated: boolean;
    inViewport: boolean;
    observer: IntersectionObserver | null;
}

interface Registration {
    canvas: HTMLCanvasElement;
    getValue: () => number;
    animated: boolean;
}

/** Snapshot for useSyncExternalStore — bumped only on pause/status/registry size. */
export interface KnobSchedulerSnapshot {
    isPaused: boolean;
    status: KnobGpuStatus;
    registrySize: number;
    version: number;
}

/** Test/debug counters — not for production UI. */
export interface KnobGpuDebugStats {
    submitCount: number;
    frameCount: number;
    isLoopRunning: boolean;
    registrySize: number;
    dirtyCount: number;
    animatedCount: number;
}

import { KNOB_MATERIAL, rgbToWgsl, resolveTickPositions, resolveDetentPositions, tickAnglesToWgslArray, tickMajorFlagsToWgslArray, detentAnglesToWgslArray, usesHardwarePointer } from './knobMaterial';
import type { KnobMaterial } from './knobMaterial';
import { getPrefersReducedMotion, resolveKnobTimeUniform, shouldAnimateKnob, subscribeReducedMotion } from './knobMotion';
import { engineDegradationStore } from '../stores/engineDegradationStore';
import { loadingProgressStore } from '../stores/loadingProgressStore';

type StatusListener = (status: KnobGpuStatus) => void;
type SnapshotListener = () => void;

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
    private registrations = new Map<number, Registration>();
    private pendingIds = new Set<number>();
    private nextId = 1;
    private rafId: number | null = null;
    private initPromise: Promise<boolean> | null = null;
    private status: KnobGpuStatus = 'unavailable';
    private statusListeners = new Set<StatusListener>();
    private snapshotListeners = new Set<SnapshotListener>();
    private snapshot: KnobSchedulerSnapshot = {
        isPaused: true,
        status: 'unavailable',
        registrySize: 0,
        version: 0,
    };
    private consecutiveRenderFailures = 0;
    private recoverScheduled = false;
    private deviceLostHandled = false;
    private consecutiveLosses = 0;
    private visibilityListening = false;
    private dprListening = false;
    private reducedMotionUnsub: (() => void) | null = null;
    private submitCount = 0;
    private frameCount = 0;
    /** Ids pending a render this frame (also includes animated knobs that stay dirty). */
    private dirtyIds = new Set<number>();

    /** @internal Reset singleton state between unit tests. */
    __resetForTests(): void {
        this.teardownDevice();
        this.registrations.clear();
        this.pendingIds.clear();
        this.dirtyIds.clear();
        this.nextId = 1;
        this.initPromise = null;
        this.status = 'unavailable';
        this.consecutiveRenderFailures = 0;
        this.recoverScheduled = false;
        this.deviceLostHandled = false;
        this.consecutiveLosses = 0;
        this.submitCount = 0;
        this.frameCount = 0;
        this.snapshot = {
            isPaused: true,
            status: 'unavailable',
            registrySize: 0,
            version: 0,
        };
    }

    constructor() {
        this.ensureEnvironmentListeners();
    }

    getStatus(): KnobGpuStatus {
        return this.status;
    }

    isSlotActive(handle: SlotHandle | null): boolean {
        if (!handle) return false;
        return this.slots.has(handle.id);
    }

    /** useSyncExternalStore subscribe — notified on pause/status/registry, NOT markDirty. */
    subscribe = (listener: SnapshotListener): (() => void) => {
        this.snapshotListeners.add(listener);
        return () => {
            this.snapshotListeners.delete(listener);
        };
    };

    getSnapshot = (): KnobSchedulerSnapshot => this.snapshot;

    onStatusChange(listener: StatusListener): () => void {
        this.statusListeners.add(listener);
        listener(this.status);
        return () => {
            this.statusListeners.delete(listener);
        };
    }

    getDebugStats(): KnobGpuDebugStats {
        let animatedCount = 0;
        for (const slot of this.slots.values()) {
            if (slot.animated) animatedCount++;
        }
        return {
            submitCount: this.submitCount,
            frameCount: this.frameCount,
            isLoopRunning: this.rafId !== null,
            registrySize: this.registrations.size,
            dirtyCount: this.countDirtySlots(),
            animatedCount,
        };
    }

    resetDebugStats(): void {
        this.submitCount = 0;
        this.frameCount = 0;
    }

    getRegistrySize(): number {
        return this.registrations.size;
    }

    private countDirtySlots(): number {
        let n = 0;
        for (const [id, slot] of this.slots) {
            if (slot.dirty || this.dirtyIds.has(id) || shouldAnimateKnob(slot.animated)) n++;
        }
        return n;
    }

    private bumpSnapshot(patch: Partial<KnobSchedulerSnapshot> = {}): void {
        this.snapshot = {
            ...this.snapshot,
            ...patch,
            status: this.status,
            registrySize: this.registrations.size,
            isPaused: this.rafId === null,
            version: this.snapshot.version + 1,
        };
        this.snapshotListeners.forEach((l) => l());
    }

    private setStatus(next: KnobGpuStatus): void {
        if (this.status === next) return;
        this.status = next;
        this.statusListeners.forEach((l) => l(next));
        this.bumpSnapshot({ status: next });
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

    private ensureEnvironmentListeners(): void {
        if (typeof window === 'undefined' || typeof document === 'undefined') return;

        if (!this.visibilityListening) {
            this.visibilityListening = true;
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) {
                    this.pauseLoop();
                } else {
                    this.markAllDirty();
                    this.kickLoop();
                }
            });
        }

        if (!this.dprListening) {
            this.dprListening = true;
            // media query for resolution changes when dragging across monitors
            const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
            const onDpr = () => this.markAllDirty();
            if (typeof mq.addEventListener === 'function') {
                mq.addEventListener('change', onDpr);
            } else {
                window.addEventListener('resize', onDpr);
            }
        }

        if (!this.reducedMotionUnsub) {
            this.reducedMotionUnsub = subscribeReducedMotion(() => {
                // Policy change: all knobs need a static (or newly animated) frame.
                this.markAllDirty();
            });
        }
    }

    register(canvas: HTMLCanvasElement, getValue: () => number): SlotHandle | null {
        this.ensureEnvironmentListeners();

        if (!navigator.gpu) {
            this.setStatus('unavailable');
            this.reportDegradation('navigator.gpu unavailable');
            return null;
        }

        const id = this.nextId++;
        this.registrations.set(id, { canvas, getValue, animated: false });
        this.pendingIds.add(id);
        this.setStatus('initializing');
        this.bumpSnapshot();

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
                this.markDirty(id);
            }
        });

        return { id };
    }

    private observeViewport(id: number, slot: Slot): void {
        if (typeof IntersectionObserver === 'undefined') {
            slot.inViewport = true;
            return;
        }
        slot.observer?.disconnect();
        slot.observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    const was = slot.inViewport;
                    slot.inViewport = entry.isIntersecting;
                    if (slot.inViewport && !was) {
                        this.markDirty(id);
                    }
                }
            },
            { root: null, threshold: 0 },
        );
        slot.observer.observe(slot.canvas);
        // Assume visible until first callback (avoids missing initial paint).
        slot.inViewport = true;
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

            const reg = this.registrations.get(id);
            const slot: Slot = {
                canvas,
                context,
                getValue,
                uniformBuffer,
                bindGroup,
                width: canvas.width,
                height: canvas.height,
                dirty: true,
                animated: reg?.animated ?? false,
                inViewport: true,
                observer: null,
            };
            this.slots.set(id, slot);
            this.observeViewport(id, slot);
            this.dirtyIds.add(id);
            this.kickLoop();
            this.bumpSnapshot();
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
        this.dirtyIds.delete(handle.id);

        const slot = this.slots.get(handle.id);
        if (slot) {
            slot.observer?.disconnect();
            slot.observer = null;
            if (slot.uniformBuffer && typeof slot.uniformBuffer.destroy === 'function') {
                slot.uniformBuffer.destroy();
            }
            this.slots.delete(handle.id);
        }

        if (this.slots.size === 0) {
            this.pauseLoop();
        }
        this.bumpSnapshot();
        // Sweep guard: drop any stale dirty ids that no longer map to registrations.
        for (const id of [...this.dirtyIds]) {
            if (!this.registrations.has(id)) this.dirtyIds.delete(id);
        }
    }

    /**
     * Mark a knob dirty. Kick-starts the shared loop when dormant.
     * Does NOT notify React subscribers (loop reads dirty-set directly).
     *
     * Modulation (LFO → cutoff, etc.): prefer push — call markDirty from the
     * audio/automation change notification rather than polling DSP in the rAF
     * loop, so idle cost stays zero.
     */
    markDirty(handleOrId: SlotHandle | number | null | undefined): void {
        if (handleOrId == null) return;
        const id = typeof handleOrId === 'number' ? handleOrId : handleOrId.id;
        if (!this.registrations.has(id) && !this.slots.has(id)) return;
        this.dirtyIds.add(id);
        const slot = this.slots.get(id);
        if (slot) slot.dirty = true;
        this.kickLoop();
    }

    /** Mark every registered knob dirty (device restore, visibility resume, DPR, theme). */
    markAllDirty(): void {
        for (const id of this.registrations.keys()) {
            this.dirtyIds.add(id);
            const slot = this.slots.get(id);
            if (slot) slot.dirty = true;
        }
        this.kickLoop();
    }

    /**
     * Enter/exit the animated state (drag / hover / keyboard-focus).
     * Only the actively-interacting knob advances the time uniform.
     */
    setAnimated(handleOrId: SlotHandle | number | null | undefined, animated: boolean): void {
        if (handleOrId == null) return;
        const id = typeof handleOrId === 'number' ? handleOrId : handleOrId.id;
        const reg = this.registrations.get(id);
        if (reg) reg.animated = animated;
        const slot = this.slots.get(id);
        if (slot) slot.animated = animated;
        this.markDirty(id);
    }

    /**
     * Render one knob immediately (pointermove path) so input-to-photon latency
     * is one frame, not "next shared pass".
     */
    renderImmediate(handleOrId: SlotHandle | number | null | undefined): void {
        if (handleOrId == null) return;
        if (!this.device || !this.pipeline || document.hidden) return;
        const id = typeof handleOrId === 'number' ? handleOrId : handleOrId.id;
        const slot = this.slots.get(id);
        if (!slot || !slot.inViewport) return;
        this.renderSlots([id], performance.now() / 1000, /*priorityOnly*/ true);
        // Keep animated knobs dirty so the shared loop continues advancing time.
        if (shouldAnimateKnob(slot.animated)) {
            slot.dirty = true;
            this.dirtyIds.add(id);
            this.kickLoop();
        } else {
            slot.dirty = false;
            this.dirtyIds.delete(id);
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
            this.consecutiveLosses = 0;
            this.markAllDirty();
            return true;
        }

        this.setStatus('degraded');
        this.reportDegradation('retry succeeded but no slots attached');
        return false;
    }

    private teardownDevice(): void {
        for (const slot of this.slots.values()) {
            try {
                slot.observer?.disconnect();
                slot.uniformBuffer?.destroy?.();
            } catch { /* noop */ }
        }
        this.slots.clear();
        this.dirtyIds.clear();
        this.pauseLoop();
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
        this.consecutiveLosses++;
        this.setStatus('degraded');
        this.reportDegradation(reason);
        // After repeated losses, stay on Canvas2D fallback (status degraded).
        if (this.consecutiveLosses >= 3) {
            this.recoverScheduled = false;
            this.reportDegradation(`${reason} (giving up after ${this.consecutiveLosses} losses)`);
            return;
        }
        const backoff = 400 * this.consecutiveLosses;
        window.setTimeout(() => {
            this.recoverScheduled = false;
            void this.retryInit();
        }, backoff);
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

    private pauseLoop(): void {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
            this.bumpSnapshot({ isPaused: true });
        }
    }

    /** Kick-start the shared loop when dormant. Self-terminates when nothing is dirty. */
    private kickLoop(): void {
        if (this.rafId !== null) return;
        if (typeof document !== 'undefined' && document.hidden) return;
        if (this.slots.size === 0 && this.dirtyIds.size === 0) return;

        const wasPaused = this.rafId === null;
        const loop = () => {
            this.rafId = null;
            const needsAnother = this.renderDirtyFrame();
            if (needsAnother && !(typeof document !== 'undefined' && document.hidden)) {
                this.rafId = requestAnimationFrame(loop);
            } else {
                this.bumpSnapshot({ isPaused: true });
            }
        };
        this.rafId = requestAnimationFrame(loop);
        if (wasPaused) this.bumpSnapshot({ isPaused: false });
    }

    /**
     * Render dirty + in-viewport knobs. Animated knobs stay dirty so time advances.
     * Returns true if the loop should continue.
     */
    private renderDirtyFrame(): boolean {
        this.frameCount++;
        if (!this.device || !this.pipeline || this.slots.size === 0) return false;
        if (typeof document !== 'undefined' && document.hidden) return false;

        const reduced = getPrefersReducedMotion();
        const now = performance.now() / 1000;

        // Collect work: dirty ids + animated knobs that must keep ticking.
        const ids: number[] = [];
        const animatedFirst: number[] = [];

        for (const [id, slot] of this.slots) {
            const animate = shouldAnimateKnob(slot.animated);
            if (animate) {
                slot.dirty = true;
                this.dirtyIds.add(id);
            }
            if ((slot.dirty || this.dirtyIds.has(id)) && slot.inViewport) {
                if (slot.animated) animatedFirst.push(id);
                else ids.push(id);
            }
        }

        // Drag priority: actively-interacting knobs render first.
        const ordered = animatedFirst.concat(ids);
        if (ordered.length === 0) return false;

        this.renderSlots(ordered, now, false);

        // Clear dirty for static knobs; keep animated dirty for next frame.
        let stillDirty = false;
        for (const id of ordered) {
            const slot = this.slots.get(id);
            if (!slot) {
                this.dirtyIds.delete(id);
                continue;
            }
            if (shouldAnimateKnob(slot.animated) && !reduced) {
                slot.dirty = true;
                this.dirtyIds.add(id);
                stillDirty = true;
            } else {
                slot.dirty = false;
                this.dirtyIds.delete(id);
            }
        }

        // Any remaining dirty (e.g. offscreen that became relevant) keeps loop alive.
        if (!stillDirty) {
            for (const id of this.dirtyIds) {
                const slot = this.slots.get(id);
                if (slot?.dirty) {
                    stillDirty = true;
                    break;
                }
            }
        }

        return stillDirty;
    }

    private renderSlots(ids: number[], nowSeconds: number, _priorityOnly: boolean): void {
        if (!this.device || !this.pipeline || ids.length === 0) return;

        const encoder = this.device.createCommandEncoder();
        let hasPass = false;
        let frameFailures = 0;
        const reduced = getPrefersReducedMotion();

        for (const id of ids) {
            const slot = this.slots.get(id);
            if (!slot || !slot.inViewport) continue;
            try {
                // Sync canvas buffer size if DPR/layout changed.
                if (slot.canvas.width !== slot.width || slot.canvas.height !== slot.height) {
                    slot.width = slot.canvas.width;
                    slot.height = slot.canvas.height;
                }

                const value = slot.getValue();
                const time = resolveKnobTimeUniform(nowSeconds, slot.animated, reduced);
                const uniforms = new Float32Array([time, value, slot.width, slot.height]);
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
                this.submitCount++;
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
