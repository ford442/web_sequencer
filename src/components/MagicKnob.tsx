import React, { useRef, useEffect } from 'react';
import bezelImg from './assets/knob-bezel.png';

interface MagicKnobProps {
    value: number; // 0.0 to 1.0
    min?: number;
    max?: number;
    label?: string;
    size?: number;
    onChange?: (val: number) => void;
}

// ⚡ Bolt: Added React.memo to prevent unnecessary re-renders when parent state changes.
export const MagicKnob: React.FC<MagicKnobProps> = React.memo(({
                                                        value,
                                                        min = 0,
                                                        max = 100,
                                                        label = "HOLO",
                                                        size = 100,
                                                        onChange,
                                                    }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // --- State Refs (Persist logic without re-renders) ---
    const stateRef = useRef({
        isDragging: false,
        startY: 0,
        startVal: 0
    });

    const valueRef = useRef(value);
    const onChangeRef = useRef(onChange);

    useEffect(() => { valueRef.current = value; }, [value]);
    useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

    // --- Interaction Logic ---
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const onDown = (e: MouseEvent) => {
            e.preventDefault();
            stateRef.current.isDragging = true;
            stateRef.current.startY = e.clientY;
            stateRef.current.startVal = valueRef.current;
            document.body.style.cursor = 'ns-resize';
        };

        const onMove = (e: MouseEvent) => {
            if (!stateRef.current.isDragging) return;
            const dy = stateRef.current.startY - e.clientY;
            const range = max - min;
            const delta = (dy / 200) * range;
            let newVal = stateRef.current.startVal + delta;
            newVal = Math.max(min, Math.min(max, newVal));
            if (onChangeRef.current) onChangeRef.current(newVal);
        };

        const onUp = () => {
            stateRef.current.isDragging = false;
            document.body.style.cursor = 'default';
        };

        // Attach to container to catch clicks on the bezel/canvas
        const container = canvas.parentElement;
        container?.addEventListener('mousedown', onDown);
        const onWheel = (ev: WheelEvent) => {
            ev.preventDefault();
            const direction = ev.deltaY > 0 ? -1 : 1;
            const range = max - min;
            const delta = direction * (range / 100);
            let newVal = valueRef.current + delta;
            newVal = Math.max(min, Math.min(max, newVal));
            if (onChangeRef.current) onChangeRef.current(newVal);
        };
        container?.addEventListener('wheel', onWheel, { passive: false });
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);

        return () => {
            container?.removeEventListener('mousedown', onDown);
            container?.removeEventListener('wheel', onWheel as any);
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
    }, [min, max]);

    // --- WebGPU Holographic Shader ---
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        let context: GPUCanvasContext | null = null;
        let device: GPUDevice | null = null;
        let pipeline: GPURenderPipeline | null = null;
        let uniformBuffer: GPUBuffer | null = null;
        let animationId: number;

        const init = async () => {
            if (!navigator.gpu) return;
            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) return;
            device = await adapter.requestDevice();
            context = canvas.getContext('webgpu') as GPUCanvasContext;
            const format = navigator.gpu.getPreferredCanvasFormat();
            context.configure({ device, format, alphaMode: 'premultiplied' });

            // --- HOLOGRAPHIC SHADER ---
            // Features: Scanlines, Rim Glow, Data Ring, "Projected" floating feel
            const shaderCode = `
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
                  var color = vec3f(0.0, 0.9, 1.0);
                  var alpha = 0.0;

                  // 1. Outer Data Ring
                  // Rotating dashed ring
                  let rot_uv = rotate(u.time * 0.2) * uv;
                  let ring_dist = abs(length(rot_uv) - 0.55);
                  let dash = sin(atan2(rot_uv.y, rot_uv.x) * 20.0);
                  if (ring_dist < 0.02 && dash > 0.5) {
                      alpha += 0.6 * smoothstep(0.02, 0.0, ring_dist);
                  }

                  // 2. Value Arc (The "Level" Indicator)
                  // Map value 0..1 to angle range [-max_angle, +max_angle]
                  // Knob starts at bottom-left, sweeps clockwise to bottom-right.
                  let max_angle = 2.4;
                  let val_mapped = mix(-max_angle, max_angle, u.value);

                  // Needle direction: rotate standard "up" (+Y) by val_mapped
                  let needle_vec = vec2f(sin(val_mapped), cos(val_mapped));

                  // Value arc: light the inner ring where the pixel angle <= val_mapped
                  // atan2 gives [-π, π]; we shift so 0 = straight up (matches needle_vec above)
                  let pixel_angle = atan2(uv.x, uv.y); // note: swapped args for "up = 0" convention
                  let arc_radius = 0.42;
                  let arc_dist = abs(length(uv) - arc_radius);
                  // Only draw arc within the ±max_angle sweep and up to the current value
                  if (arc_dist < 0.03 && pixel_angle >= -max_angle && pixel_angle <= val_mapped) {
                      let arc_brightness = smoothstep(0.03, 0.0, arc_dist);
                      // Color shifts from teal at min to bright cyan at current value
                      let arc_t = (pixel_angle + max_angle) / (val_mapped + max_angle + 0.001);
                      color = mix(vec3f(0.0, 0.6, 0.5), vec3f(0.2, 1.0, 0.8), arc_t);
                      alpha += arc_brightness * 0.85;
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

                  // The Needle
                  let proj = dot(uv, needle_vec);
                  let perp = length(uv - needle_vec * proj);
                  // Guard against perp ≈ 0 to avoid Inf bloom
                  if (proj > 0.0 && proj < 0.5 && perp < 0.02 && perp > 0.0005) {
                      alpha += min(1.0 / (perp * 100.0), 8.0); // Bloom needle, clamped
                      color = vec3f(1.0, 1.0, 1.0); // White hot center
                  }

                  // 5. Fresnel / Glitch Effect
                  let glitch = step(0.98, sin(u.time * 20.0 + uv.y * 10.0));
                  if (glitch > 0.5) {
                      uv.x += 0.05;
                      alpha += 0.2;
                  }

                  // Vignette / Falloff at edges of canvas
                  alpha *= smoothstep(0.8, 0.6, len);

                  return vec4f(color * alpha * 1.5, alpha);
                }
            `;

            const module = device.createShaderModule({ code: shaderCode });
            pipeline = device.createRenderPipeline({
                layout: 'auto',
                vertex: { module, entryPoint: 'vs_main' },
                fragment: { module, entryPoint: 'fs_main', targets: [{ format }] },
                primitive: { topology: 'triangle-list' }
            });

            uniformBuffer = device.createBuffer({
                size: 32,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
            });

            // Create bind group once — reused every frame (only uniformBuffer is written each frame)
            bindGroup = device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
            });
        };

        let bindGroup: GPUBindGroup | null = null;

        const render = () => {
            if (!context || !device || !pipeline || !uniformBuffer || !bindGroup) return;

            const now = performance.now() / 1000;
            const normalizedValue = (valueRef.current - min) / (max - min);
            const uniforms = new Float32Array([now, normalizedValue, canvas.width, canvas.height]);
            device.queue.writeBuffer(uniformBuffer, 0, uniforms);

            const encoder = device.createCommandEncoder();
            const pass = encoder.beginRenderPass({
                colorAttachments: [{
                    view: context.getCurrentTexture().createView(),
                    loadOp: 'clear',
                    clearValue: { r: 0, g: 0, b: 0, a: 0 },
                    storeOp: 'store'
                }]
            });

            pass.setPipeline(pipeline);
            pass.setBindGroup(0, bindGroup);
            pass.draw(3);
            pass.end();

            device.queue.submit([encoder.finish()]);
            animationId = requestAnimationFrame(render);
        };

        init().then(() => render());
        return () => cancelAnimationFrame(animationId);
    }, [min, max]); // Re-init if range changes

    return (
        <div className="flex flex-col items-center select-none" style={{ cursor: 'pointer' }} tabIndex={0}
            onKeyDown={(e) => {
                if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
                    const range = max - min;
                    const step = range / 100;
                    let newVal = valueRef.current + step;
                    newVal = Math.max(min, Math.min(max, newVal));
                    if (onChangeRef.current) onChangeRef.current(newVal);
                    e.preventDefault();
                } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
                    const range = max - min;
                    const step = range / 100;
                    let newVal = valueRef.current - step;
                    newVal = Math.max(min, Math.min(max, newVal));
                    if (onChangeRef.current) onChangeRef.current(newVal);
                    e.preventDefault();
                }
            }}
        >
            <div style={{ position: 'relative', width: size, height: size }}>
                
                {/* Bezel is now BOTTOM Layer (Z-Index 0) */}
                <img 
                    src={bezelImg} 
                    alt="knob bezel"
                    style={{ 
                        width: '100%', 
                        height: '100%', 
                        position: 'absolute', 
                        top: 0, 
                        left: 0, 
                        zIndex: 0, 
                        pointerEvents: 'none',
                        opacity: 0.8 
                    }} 
                />

                {/* Hologram Canvas is TOP Layer (Z-Index 10) */}
                <canvas
                    ref={canvasRef}
                    width={size * 2}
                    height={size * 2}
                    style={{
                        width: '100%',
                        height: '100%',
                        borderRadius: '50%',
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        zIndex: 10, // Above the bezel
                        pointerEvents: 'none' // Let clicks pass through to container
                    }}
                />
            </div>
            <span className="text-xs font-orbitron text-cyan-400 mt-1 drop-shadow-[0_0_5px_rgba(34,211,238,0.8)]">
                {label}
            </span>
        </div>
    );
});
