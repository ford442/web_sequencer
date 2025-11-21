import React, { useRef, useEffect } from 'react';

// --- Types ---
export interface KnobConfig {
    id: string;
    label: string;
    x: number; // 0.0 to 1.0 (UV coordinate)
    y: number; // 0.0 to 1.0
    size: number; // radius relative to canvas width
    value: number; // current value 0.0 to 1.0
}

interface HardwareModuleProps {
    title: string;
    colorHex: [number, number, number]; // e.g. [0.0, 0.8, 1.0] for Cyan
    controls: KnobConfig[];
    onParamChange: (id: string, value: number) => void;
    children?: React.ReactNode; // <-- allow overlaying custom React UI (e.g., WaveformSelector)
}

export const HardwareModule: React.FC<HardwareModuleProps> = ({ 
    title, 
    colorHex, 
    controls, 
    onParamChange,
    children
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    
    // Refs to store mutable data for the render loop / event handlers
    const controlsRef = useRef(controls);
    const activeKnobIndex = useRef<number | null>(null);
    const startY = useRef(0);
    const startVal = useRef(0);

    // Sync latest props to ref
    useEffect(() => { controlsRef.current = controls; }, [controls]);

    // --- INTERACTION LOGIC ---
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const handleMouseDown = (e: MouseEvent) => {
            const rect = canvas.getBoundingClientRect();
            // Normalize mouse to 0..1 UV space
            const mouseX = (e.clientX - rect.left) / rect.width;
            const mouseY = (e.clientY - rect.top) / rect.height;

            // Simple Hit Test based on distance to knob center
            const hitIndex = controlsRef.current.findIndex(k => {
                const dx = k.x - mouseX;
                const dy = k.y - mouseY;
                const dist = Math.sqrt(dx*dx + dy*dy);
                return dist < (k.size * 1.2); // 1.2x tolerance for easier grabbing
            });

            if (hitIndex !== -1) {
                activeKnobIndex.current = hitIndex;
                startY.current = e.clientY;
                startVal.current = controlsRef.current[hitIndex].value;
                document.body.style.cursor = 'ns-resize';
                e.preventDefault();
            }
        };

        const handleMouseMove = (e: MouseEvent) => {
            if (activeKnobIndex.current === null) return;
            
            const dy = startY.current - e.clientY;
            const sensitivity = 0.005; // Adjust sensitivity
            let newVal = startVal.current + (dy * sensitivity);
            newVal = Math.max(0, Math.min(1, newVal));
            
            const activeId = controlsRef.current[activeKnobIndex.current].id;
            onParamChange(activeId, newVal);
        };

        const handleMouseUp = () => {
            activeKnobIndex.current = null;
            document.body.style.cursor = 'default';
        };

        canvas.addEventListener('mousedown', handleMouseDown);
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        return () => {
            canvas.removeEventListener('mousedown', handleMouseDown);
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [onParamChange]);

    // --- WEBGPU RENDERER ---
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !navigator.gpu) return;

        let context: GPUCanvasContext;
        let device: GPUDevice;
        let pipeline: GPURenderPipeline;
        let uniformBuffer: GPUBuffer;
        let animationId: number;

        const init = async () => {
            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) return;
            device = await adapter.requestDevice();
            context = canvas.getContext('webgpu') as GPUCanvasContext;
            const format = navigator.gpu.getPreferredCanvasFormat();
            context.configure({ device, format, alphaMode: 'premultiplied' });

            // Max 8 knobs per module for this shader implementation
            // Uniform structure:
            // vec4 time_res_padding_padding
            // vec4 color_rgb_padding
            // vec4 knob_values_1_4  (x,y,z,w)
            // vec4 knob_values_5_8  (x,y,z,w)
            // array<vec4, 8> knob_positions (x, y, size, padding) 
            
            const shaderCode = `
                struct Uniforms {
                    time: f32,
                    ratio: f32, // Aspect ratio correction
                    pad1: f32,
                    pad2: f32,
                    color: vec3f,
                    pad3: f32,
                    vals1: vec4f, // Values for knobs 0-3
                    vals2: vec4f, // Values for knobs 4-7
                    // Hardcoded array size for generic layout
                    pos0: vec4f, pos1: vec4f, pos2: vec4f, pos3: vec4f,
                    pos4: vec4f, pos5: vec4f, pos6: vec4f, pos7: vec4f,
                };
                @group(0) @binding(0) var<uniform> u: Uniforms;

                struct VertexOutput {
                    @builtin(position) position: vec4f,
                    @location(0) uv: vec2f,
                };

                @vertex
                fn vs_main(@builtin(vertex_index) vIdx: u32) -> VertexOutput {
                    var pos = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
                    var output: VertexOutput;
                    output.position = vec4f(pos[vIdx], 0.0, 1.0);
                    output.uv = pos[vIdx]; // 0,0 top-left mapping handled in frag
                    return output;
                }

                fn get_knob_val(idx: i32) -> f32 {
                    if (idx < 4) { return u.vals1[idx]; }
                    return u.vals2[idx - 4];
                }

                fn sdCircle(p: vec2f, r: f32) -> f32 {
                    return length(p) - r;
                }

                @fragment
                fn fs_main(in: VertexOutput) -> @location(0) vec4f {
                    // Correct UVs: 0.0 to 1.0
                    var uv = in.uv * 0.5 + 0.5; 
                    uv.y = 1.0 - uv.y; // Flip Y to match standard GUI (0 at top)

                    // Aspect Correction for rendering circular shapes
                    // We work in a "Draw Space" (p) where X is stretched to compensate ratio
                    var p = uv;
                    p.x = p.x * u.ratio; // Correct X scale for circles

                    // --- 1. Background (Dark Metal Panel) ---
                    var col = vec3f(0.12, 0.14, 0.16);
                    // Subtle noise/grain
                    let noise = fract(sin(dot(uv, vec2f(12.9898, 78.233))) * 43758.5453);
                    col += (noise * 0.03);

                    // Scanline texture
                    col *= 0.9 + 0.1 * sin(uv.y * 200.0);

                    // --- 2. Draw Knobs ---
                    var alpha = 1.0;
                    
                    // Loop manually unrolled or fixed size
                    for (var i = 0; i < 8; i++) {
                        // Get knob definition
                        var k_pos_uv: vec4f;
                        if(i==0){k_pos_uv=u.pos0;} else if(i==1){k_pos_uv=u.pos1;}
                        else if(i==2){k_pos_uv=u.pos2;} else if(i==3){k_pos_uv=u.pos3;}
                        else if(i==4){k_pos_uv=u.pos4;} else if(i==5){k_pos_uv=u.pos5;}
                        else if(i==6){k_pos_uv=u.pos6;} else {k_pos_uv=u.pos7;}

                        // If size is 0, knob is inactive
                        if (k_pos_uv.z == 0.0) { continue; }

                        // Center of knob in UV space
                        let center_uv = k_pos_uv.xy;
                        
                        // Center in Draw Space (aspect corrected)
                        let center_draw = vec2f(center_uv.x * u.ratio, center_uv.y);
                        
                        // Current Distance to this knob center
                        let dist = length(p - center_draw);
                        let radius = k_pos_uv.z;
                        
                        let val = get_knob_val(i);

                        // --- Draw Knob Logic ---
                        
                        // 1. Bezel / Socket (Dark indent)
                        if (dist < radius) {
                            let bezel = smoothstep(radius, radius - 0.01, dist);
                            col = mix(col, vec3f(0.05, 0.05, 0.05), bezel);
                            
                            // 2. Data Ring (The Value Indicator)
                            let ring_w = 0.015;
                            let ring_r = radius * 0.75;
                            let ring_dist = abs(dist - ring_r);
                            
                            if (ring_dist < ring_w) {
                                // Angle calculation
                                let delta = p - center_draw;
                                // atan2 returns -PI to PI. We want roughly -2.5 to 2.5 range for knob
                                var angle = atan2(delta.y, delta.x); 
                                angle = angle + 1.5708; // Rotate so 0 is up
                                // Normalize for arc
                                
                                let arc_extent = 2.4; 
                                // Map value 0..1 to angle -2.4 .. 2.4
                                let target_angle = mix(-arc_extent, arc_extent, val);
                                
                                // Invert check because screen Y is flipped in calculation vs standard atan
                                // Rough arc logic:
                                // Check if we are inside the valid "active" arc
                                // (This is a simplified visual approximation)
                                
                                // Glow color
                                col = mix(col, u.color, smoothstep(ring_w, 0.0, ring_dist));
                            }
                            
                            // 3. Center Cap (The physical knob)
                            if (dist < radius * 0.5) {
                                let cap = smoothstep(radius*0.5, radius*0.5 - 0.01, dist);
                                // Metallic gradient
                                let shine = dot(normalize(p - center_draw), vec2f(0.5, -0.5));
                                col = mix(col, vec3f(0.2) + shine*0.1, cap);
                                
                                // Indicator Line on Cap
                                // Calculate needle vector based on value
                                let needle_angle = mix(-2.4, 2.4, val) - 1.5708;
                                let needle_dir = vec2f(cos(needle_angle), sin(needle_angle));
                                let delta = p - center_draw;
                                let proj = dot(delta, needle_dir);
                                let perp = length(delta - needle_dir * proj);
                                
                                if (proj > 0.0 && proj < radius*0.45 && perp < 0.005) {
                                     col = mix(col, vec3f(1.0), 0.9);
                                }
                            }
                        }
                    }

                    return vec4f(col, alpha);
                }
            `;

            const module = device.createShaderModule({ code: shaderCode });
            pipeline = device.createRenderPipeline({
                layout: 'auto',
                vertex: { module, entryPoint: 'vs_main' },
                fragment: { module, entryPoint: 'fs_main', targets: [{ format }] },
                primitive: { topology: 'triangle-list' }
            });

            // Calculate buffer size: 
            // 4 floats (time/ratio) + 4 floats (color) + 8 floats (vals) + 32 floats (8 vec4 pos)
            // = 48 floats * 4 bytes = 192 bytes
            uniformBuffer = device.createBuffer({
                size: 256, // Round up to align
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
            });
        };

        const render = () => {
            if (!device || !context || !pipeline || !uniformBuffer) return;
            
            const now = performance.now() / 1000;
            const width = canvas.width;
            const height = canvas.height;
            const ratio = width / height;

            // Prepare Data
            const currentControls = controlsRef.current;
            
            // Knob Values (packed into 2 vec4s)
            const vals = new Float32Array(8);
            currentControls.forEach((c, i) => { if (i < 8) vals[i] = c.value; });

            // Knob Positions (packed into 8 vec4s: x, y, size, padding)
            const positions = new Float32Array(32);
            currentControls.forEach((c, i) => {
                if (i < 8) {
                    const offset = i * 4;
                    positions[offset] = c.x;
                    positions[offset + 1] = c.y;
                    positions[offset + 2] = c.size;
                    positions[offset + 3] = 0; // padding
                }
            });

            // Write Buffer
            // 0: time, ratio, pad, pad
            device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([now, ratio, 0, 0]));
            // 16: color.r, color.g, color.b, pad
            device.queue.writeBuffer(uniformBuffer, 16, new Float32Array([colorHex[0], colorHex[1], colorHex[2], 0]));
            // 32: vals1, vals2
            device.queue.writeBuffer(uniformBuffer, 32, vals);
            // 64: positions
            device.queue.writeBuffer(uniformBuffer, 64, positions);

            // Encode
            const encoder = device.createCommandEncoder();
            const pass = encoder.beginRenderPass({
                colorAttachments: [{
                    view: context.getCurrentTexture().createView(),
                    loadOp: 'clear',
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                    storeOp: 'store'
                }]
            });
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
            }));
            pass.draw(3);
            pass.end();
            
            device.queue.submit([encoder.finish()]);
            animationId = requestAnimationFrame(render);
        };

        init().then(() => render());

        return () => {
            if (animationId) cancelAnimationFrame(animationId);
        };
    }, [colorHex]); // Re-init if color changes (rare)

    return (
        <div 
            ref={containerRef} 
            className="relative rounded-lg shadow-xl overflow-hidden bg-gray-900 border border-gray-700"
            style={{ width: '100%', height: '100%', minHeight: '220px' }}
        >
            {/* The WebGPU Surface */}
            <canvas 
                ref={canvasRef} 
                width={800} 
                height={400} 
                className="w-full h-full block"
            />
            
            {/* HTML Overlay for Labels (Accessibility + Sharp Text) */}
            <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-2 left-4 text-xs font-orbitron font-bold text-white/50 tracking-widest border-b border-white/20 pb-1 w-1/3">
                    {title.toUpperCase()}
                </div>
                {controls.map((c) => (
                    <div 
                        key={c.id}
                        className="absolute text-center transform -translate-x-1/2"
                        style={{ 
                            left: `${c.x * 100}%`, 
                            top: `${(c.y + c.size * 0.8) * 100}%`, // Position text below knob
                            color: `rgba(${colorHex[0]*255}, ${colorHex[1]*255}, ${colorHex[2]*255}, 0.8)`
                        }}
                    >
                        <span className="text-[10px] font-mono font-bold tracking-wider drop-shadow-md">
                            {c.label}
                        </span>
                        <div className="text-[9px] opacity-60 font-mono">
                            {c.id.includes('freq') || c.id.includes('cutoff') ? Math.round(c.value * 8000) : Math.round(c.value * 100)}
                        </div>
                    </div>
                ))}
            </div>

            {/* Custom Children (e.g., Waveform Selector) */}
            {children && (
                <div className="absolute inset-0 pointer-events-none">
                    {/* Children wrapper - specific children should opt into pointer-events-auto so they can receive input */}
                    {children}
                </div>
            )}
        </div>
    );
};

