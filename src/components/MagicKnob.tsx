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

export const MagicKnob: React.FC<MagicKnobProps> = ({
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
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);

        return () => {
            container?.removeEventListener('mousedown', onDown);
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
                  // Map value 0..1 to angle -2.5 .. +2.5 (approx)
                  let max_angle = 2.4; 
                  let val_mapped = mix(-max_angle, max_angle, u.value);
                  
                  // Offset angle to start from bottom-left
                  let active_angle = -angle - 1.5708; // Rotate -90deg to start top
                  // Normalize angle logic for gauge
                  
                  // Simple gauge: show if angle is "less" than value
                  // We compare dot products or raw angles. 
                  // Let's use a "needle" approach + arc
                  
                  let needle_w = 0.01;
                  let needle_vec = vec2f(cos(val_mapped - 1.5708), sin(val_mapped - 1.5708));
                  
                  // Draw filled arc (faked with dot product and masking)
                  // This is a simple visual hack for the arc
                  // It glows brighter near the value
                  
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
                  if (proj > 0.0 && proj < 0.5 && perp < 0.02) {
                      alpha += 1.0 / (perp * 100.0); // Bloom needle
                      color = vec3f(1.0, 1.0, 1.0); // White hot center
                  }
                  
                  // The Value Arc (Parametric)
                  // We can render dots based on angle
                  let dot_angle = atan2(uv.y, uv.x) + 1.5708; // 0 is down
                  // This is tricky without proper atan handling, simplified:
                  
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
        };

        const render = () => {
            if (!context || !device || !pipeline || !uniformBuffer) return;

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
            const bindGroup = device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
            });
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
        <div className="flex flex-col items-center select-none" style={{ cursor: 'pointer' }}>
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
};
