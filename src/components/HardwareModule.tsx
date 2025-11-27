import React, { useRef, useEffect } from 'react';
import { useWebGpuDevice } from '../hooks/useWebGpuDevice';

// --- Types ---
export interface KnobConfig {
    id: string;
    label: string;
    x: number; // 0.0 to 1.0 (UV coordinate)
    y: number; // 0.0 to 1.0
    size: number; // radius relative to canvas width
    value: number; // current value 0.0 to 1.0
    isRecording?: boolean; // Whether this knob is in record mode
}

interface HardwareModuleProps {
    title: string;
    colorHex: [number, number, number]; // e.g. [0.0, 0.8, 1.0] for Cyan
    controls: KnobConfig[];
    onParamChange: (id: string, value: number) => void;
    onRecordToggle?: (id: string) => void; // Callback when record button is clicked
    children?: React.ReactNode; // <-- allow overlaying custom React UI (e.g., WaveformSelector)
    trackId?: string;
    isRemote?: boolean;
    onToggleRemote?: (trackId: string) => void;
}

export const HardwareModule = React.memo(
  ({
    title,
    colorHex, 
    controls, 
    onParamChange,
    onRecordToggle,
    children,
    trackId,
    isRemote,
    onToggleRemote
  }: HardwareModuleProps) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    
    // Refs to store mutable data for the render loop / event handlers
    const controlsRef = useRef(controls);
    const activeKnobIndex = useRef<number | null>(null);
    const startY = useRef(0);
    const startVal = useRef(0);
    const { device, preferredFormat } = useWebGpuDevice();

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
        if (!canvas || !device || !preferredFormat) return;

        const context = canvas.getContext('webgpu') as GPUCanvasContext;
        context.configure({ device, format: preferredFormat, alphaMode: 'premultiplied' });

        const shaderCode = `
            struct Uniforms {
                time: f32,
                ratio: f32,
                pad1: f32,
                pad2: f32,
                color: vec3f,
                pad3: f32,
                vals1: vec4f,
                vals2: vec4f,
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
                output.uv = pos[vIdx];
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
                var uv = in.uv * 0.5 + 0.5;
                uv.y = 1.0 - uv.y;

                var p = uv;
                p.x = p.x * u.ratio;

                var col = vec3f(0.12, 0.14, 0.16);
                let noise = fract(sin(dot(uv, vec2f(12.9898, 78.233))) * 43758.5453);
                col += (noise * 0.03);
                col *= 0.9 + 0.1 * sin(uv.y * 200.0);

                var alpha = 1.0;
                for (var i = 0; i < 8; i++) {
                    var k_pos_uv: vec4f;
                    if(i==0){k_pos_uv=u.pos0;} else if(i==1){k_pos_uv=u.pos1;}
                    else if(i==2){k_pos_uv=u.pos2;} else if(i==3){k_pos_uv=u.pos3;}
                    else if(i==4){k_pos_uv=u.pos4;} else if(i==5){k_pos_uv=u.pos5;}
                    else if(i==6){k_pos_uv=u.pos6;} else {k_pos_uv=u.pos7;}

                    if (k_pos_uv.z == 0.0) { continue; }

                    let center_uv = k_pos_uv.xy;
                    let center_draw = vec2f(center_uv.x * u.ratio, center_uv.y);
                    let dist = length(p - center_draw);
                    let radius = k_pos_uv.z;
                    let val = get_knob_val(i);

                    if (dist < radius) {
                        let bezel = smoothstep(radius, radius - 0.01, dist);
                        col = mix(col, vec3f(0.05, 0.05, 0.05), bezel);
                        let ring_w = 0.015;
                        let ring_r = radius * 0.75;
                        let ring_dist = abs(dist - ring_r);
                        if (ring_dist < ring_w) {
                            col = mix(col, u.color, smoothstep(ring_w, 0.0, ring_dist));
                        }
                        if (dist < radius * 0.5) {
                            let cap = smoothstep(radius*0.5, radius*0.5 - 0.01, dist);
                            let shine = dot(normalize(p - center_draw), vec2f(0.5, -0.5));
                            col = mix(col, vec3f(0.2) + shine*0.1, cap);
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
        const pipeline = device.createRenderPipeline({
            layout: 'auto',
            vertex: { module, entryPoint: 'vs_main' },
            fragment: { module, entryPoint: 'fs_main', targets: [{ format: preferredFormat }] },
            primitive: { topology: 'triangle-list' }
        });

        const uniformBuffer = device.createBuffer({
            size: 256,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        let animationId: number | null = null;

        const render = () => {
            const now = performance.now() / 1000;
            const width = canvas.width;
            const height = canvas.height;
            const ratio = width / height;

            const currentControls = controlsRef.current;
            const vals = new Float32Array(8);
            currentControls.forEach((c, i) => { if (i < 8) vals[i] = c.value; });
            const positions = new Float32Array(32);
            currentControls.forEach((c, i) => {
                if (i < 8) {
                    const offset = i * 4;
                    positions[offset] = c.x;
                    positions[offset + 1] = c.y;
                    positions[offset + 2] = c.size;
                    positions[offset + 3] = 0;
                }
            });

            device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([now, ratio, 0, 0]));
            device.queue.writeBuffer(uniformBuffer, 16, new Float32Array([colorHex[0], colorHex[1], colorHex[2], 0]));
            device.queue.writeBuffer(uniformBuffer, 32, vals);
            device.queue.writeBuffer(uniformBuffer, 64, positions);

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

        render();

        return () => {
            if (animationId) cancelAnimationFrame(animationId);
        };
    }, [colorHex, device, preferredFormat]);

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
                <div className="absolute top-2 left-4 text-xs font-orbitron font-bold text-white/50 tracking-widest border-b border-white/20 pb-1" style={{width: 'calc(100% - 150px)'}}>
                    {title.toUpperCase()}
                </div>

                {/* --- REMOTE TOGGLE --- */}
                {trackId && onToggleRemote && (
                    <div className="absolute top-2 right-20 pointer-events-auto flex items-center gap-2">
                        <span className={`text-xs font-bold font-mono ${isRemote ? 'text-purple-400' : 'text-gray-500'}`}>
                            REMOTE
                        </span>
                        <button
                            onClick={() => onToggleRemote(trackId)}
                            className={`w-12 h-6 rounded-full p-1 transition-colors ${isRemote ? 'bg-purple-600' : 'bg-gray-700'}`}
                        >
                            <div
                                className={`w-4 h-4 bg-white rounded-full shadow-md transform transition-transform ${isRemote ? 'translate-x-6' : 'translate-x-0'}`}
                            />
                        </button>
                    </div>
                )}


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
                {/* Record buttons for each knob */}
                {onRecordToggle && controls.map((c) => (
                    <button
                        key={`rec-${c.id}`}
                        onClick={(e) => {
                            e.stopPropagation();
                            onRecordToggle(c.id);
                        }}
                        className="absolute pointer-events-auto transform -translate-x-1/2 transition-all"
                        style={{
                            left: `${c.x * 100}%`,
                            top: `${(c.y - c.size * 1.3) * 100}%`,
                            width: '16px',
                            height: '16px',
                        }}
                        title={`${c.isRecording ? 'Stop' : 'Start'} recording ${c.label}`}
                    >
                        <div 
                            className={`w-full h-full rounded-full flex items-center justify-center text-[10px] font-bold transition-all ${
                                c.isRecording 
                                    ? 'bg-red-600 text-white shadow-lg shadow-red-500/50 animate-pulse' 
                                    : 'bg-gray-800 text-red-500 border border-red-900/50 hover:bg-red-900/30'
                            }`}
                        >
                            R
                        </div>
                    </button>
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
  }
);
