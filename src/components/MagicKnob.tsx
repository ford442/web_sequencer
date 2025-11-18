import React, { useRef, useEffect } from 'react';
let bezelImg = './web-sequencer/assets/knob-bezel-CPib8hRm.png';

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
                                                        label = "PLASMA",
                                                        size = 100,
                                                        onChange,
                                                    }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // --- Interaction Logic (Kept simple for brevity, same as before) ---
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !onChange) return;

        let isDragging = false;
        let startY = 0;
        let startVal = 0;

        const onDown = (e: MouseEvent) => {
            isDragging = true;
            startY = e.clientY;
            startVal = value;
            document.body.style.cursor = 'ns-resize';
        };

        const onMove = (e: MouseEvent) => {
            if (!isDragging) return;
            const dy = startY - e.clientY;
            const range = max - min;
            const delta = (dy / 200) * range;
            let newVal = startVal + delta;
            newVal = Math.max(min, Math.min(max, newVal));
            onChange(newVal);
        };

        const onUp = () => {
            isDragging = false;
            document.body.style.cursor = 'default';
        };

        // Attach listeners to the container or overlay
        // Here we attach to canvas, but since image is on top,
        // we might need to attach to the parent div or set pointer-events: none on image
        canvas.parentElement?.addEventListener('mousedown', onDown);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);

        return () => {
            canvas.parentElement?.removeEventListener('mousedown', onDown);
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
    }, [value, min, max, onChange]);

    // --- WebGPU Rendering Logic (Optimized: Plasma Only) ---
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
            context.configure({ device, format, alphaMode: 'premultiplied' }); // Enable transparency

            // --- SIMPLIFIED SHADER: No Bezel Math ---
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
          var pos = array<vec2f, 3>(
            vec2f(-1.0, -1.0),
            vec2f(3.0, -1.0),
            vec2f(-1.0, 3.0)
          );
          var output: VertexOutput;
          output.position = vec4f(pos[vIdx], 0.0, 1.0);
          output.uv = pos[vIdx]; 
          return output;
        }

        // Simple noise (same as before)
        fn hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453); }
        fn noise(p: vec2f) -> f32 {
          let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i + vec2f(0.0, 0.0)), hash(i + vec2f(1.0, 0.0)), u.x),
                     mix(hash(i + vec2f(0.0, 1.0)), hash(i + vec2f(1.0, 1.0)), u.x), u.y);
        }
        fn fbm(p: vec2f) -> f32 {
          var v = 0.0; var a = 0.5; var shift = vec2f(100.0); var pos = p;
          let rot = mat2x2f(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
          for (var i = 0; i < 5; i++) { v += a * noise(pos); pos = rot * pos * 2.0 + shift; a *= 0.5; }
          return v;
        }

        @fragment
        fn fs_main(in: VertexOutput) -> @location(0) vec4f {
          var uv = in.uv;
          let dist = length(uv);
          
          // Optimization: If outside the "glass" area, discard immediately
          if (dist > 0.68) {
             discard;
          }

          // --- Plasma Core ---
          let t = u.time * 0.5;
          var q = vec2f(0.0);
          q.x = fbm( uv + vec2f(0.0,0.0) );
          q.y = fbm( uv + vec2f(5.2,1.3) );
          var r = vec2f(0.0);
          r.x = fbm( uv + 4.0*q + vec2f(t, 9.2) );
          r.y = fbm( uv + 4.0*q + vec2f(8.3, 2.8*t) );
          let f = fbm( uv + 4.0*r );

          let c1 = vec3f(0.1, 0.0, 0.3); 
          let c2 = vec3f(0.0, 0.8, 0.9); 
          let c3 = vec3f(1.0, 0.0, 0.5);
          
          var plasma = mix(c1, c2, f);
          plasma = mix(plasma, c3, length(r));
          
          // Inner shadow / Vignette for depth
          let vignette = smoothstep(0.7, 0.2, dist);
          var color = plasma * vignette * 1.5;

          // --- Indicator Line ---
          let val_norm = u.value;
          let val_angle = mix(-2.356, 2.356, val_norm) - 1.5708;
          let needle_uv = vec2f(cos(val_angle), sin(val_angle));
          let proj = dot(uv, needle_uv);
          let perp_dist = length(uv - needle_uv * proj);
          
          if (proj > 0.0 && proj < 0.65 && perp_dist < 0.03) {
             color += vec3f(1.0, 1.0, 1.0); 
             color += vec3f(0.0, 0.8, 1.0) * (0.05 / perp_dist);
          }

          return vec4f(color, 1.0);
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
            const normalizedValue = (value - min) / (max - min);
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
    }, [value, min, max]);

    return (
        <div className="flex flex-col items-center select-none" style={{ cursor: 'pointer' }}>
            <div style={{ position: 'relative', width: size, height: size }}>
                {/* Layer 1: Dynamic Plasma Canvas (Bottom) */}
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
                        zIndex: 0
                    }}
                />

                <img src={bezelImg} style={{ width: '100%', height: '100%', position: 'absolute', top:0, left:0, zIndex: 1, pointerEvents: 'none' }} />

            </div>
            <span className="text-xs font-orbitron text-cyan-400 mt-1">{label}</span>
        </div>
    );
};
