import React, { useRef, useEffect } from 'react';

export interface KnobConfig {
    id: string;
    label: string;
    x: number;
    y: number;
    size: number;
    value: number;
    isRecording?: boolean;
}

interface HardwareModuleProps {
    title: string;
    colorHex: [number, number, number];
    controls: KnobConfig[];
    onParamChange: (id: string, value: number) => void;
    onRecordToggle?: (id: string) => void;
    children?: React.ReactNode;
}

export const HardwareModule = React.memo(
    ({
        title,
        colorHex,
        controls,
        onParamChange,
        onRecordToggle,
        children
    }: HardwareModuleProps) => {
        const canvasRef = useRef<HTMLCanvasElement>(null);
        const containerRef = useRef<HTMLDivElement>(null);
        const controlsRef = useRef(controls);
        const activeKnobIndex = useRef<number | null>(null);
        const startY = useRef(0);
        const startVal = useRef(0);

        useEffect(() => { controlsRef.current = controls; }, [controls]);

        // --- INTERACTION LOGIC (Mouse) ---
        useEffect(() => {
            const canvas = canvasRef.current;
            if (!canvas) return;

            const handleMouseDown = (e: MouseEvent) => {
                const rect = canvas.getBoundingClientRect();
                const mouseX = (e.clientX - rect.left) / rect.width;
                const mouseY = (e.clientY - rect.top) / rect.height;

                const hitIndex = controlsRef.current.findIndex(k => {
                    const dx = k.x - mouseX;
                    const dy = k.y - mouseY;
                    return Math.sqrt(dx * dx + dy * dy) < (k.size * 1.2);
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
                let newVal = startVal.current + (dy * 0.005);
                newVal = Math.max(0, Math.min(1, newVal));
                onParamChange(controlsRef.current[activeKnobIndex.current].id, newVal);
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
            let isActive = true;

            const init = async () => {
                try {
                    const adapter = await navigator.gpu.requestAdapter();
                    if (!adapter) return;

                    const newDevice = await adapter.requestDevice();
                    // If component unmounted while waiting for device, destroy it immediately
                    if (!isActive) {
                        newDevice.destroy();
                        return;
                    }
                    device = newDevice;

                    context = canvas.getContext('webgpu') as GPUCanvasContext;
                    context.configure({
                        device,
                        format: navigator.gpu.getPreferredCanvasFormat(),
                        alphaMode: 'premultiplied'
                    });

                    // Shader logic - supports up to 12 knobs
                    const shaderCode = `
                    struct Uniforms {
                        time: f32, ratio: f32, pad1: f32, pad2: f32,
                        color: vec3f, pad3: f32,
                        vals1: vec4f, vals2: vec4f, vals3: vec4f,
                        pad4: vec4f,
                        pos0: vec4f, pos1: vec4f, pos2: vec4f, pos3: vec4f,
                        pos4: vec4f, pos5: vec4f, pos6: vec4f, pos7: vec4f,
                        pos8: vec4f, pos9: vec4f, pos10: vec4f, pos11: vec4f,
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
                        if (idx < 8) { return u.vals2[idx - 4]; }
                        return u.vals3[idx - 8];
                    }

                    @fragment
                    fn fs_main(in: VertexOutput) -> @location(0) vec4f {
                        var uv = in.uv * 0.5 + 0.5; 
                        uv.y = 1.0 - uv.y;
                        var p = uv; p.x = p.x * u.ratio;

                        var col = vec3f(0.12, 0.14, 0.16);
                        col += (fract(sin(dot(uv, vec2f(12.9898, 78.233))) * 43758.5453) * 0.03);
                        col *= 0.9 + 0.1 * sin(uv.y * 200.0);

                        for (var i = 0; i < 12; i++) {
                            var k_pos_uv: vec4f;
                            if(i==0){k_pos_uv=u.pos0;} else if(i==1){k_pos_uv=u.pos1;}
                            else if(i==2){k_pos_uv=u.pos2;} else if(i==3){k_pos_uv=u.pos3;}
                            else if(i==4){k_pos_uv=u.pos4;} else if(i==5){k_pos_uv=u.pos5;}
                            else if(i==6){k_pos_uv=u.pos6;} else if(i==7){k_pos_uv=u.pos7;}
                            else if(i==8){k_pos_uv=u.pos8;} else if(i==9){k_pos_uv=u.pos9;}
                            else if(i==10){k_pos_uv=u.pos10;} else {k_pos_uv=u.pos11;}

                            if (k_pos_uv.z == 0.0) { continue; }

                            let center_draw = vec2f(k_pos_uv.x * u.ratio, k_pos_uv.y);
                            let dist = length(p - center_draw);
                            let radius = k_pos_uv.z;
                            let val = get_knob_val(i);

                            if (dist < radius) {
                                col = mix(col, vec3f(0.05), smoothstep(radius, radius - 0.01, dist));
                                let ring_dist = abs(dist - (radius * 0.75));
                                if (ring_dist < 0.015) {
                                    col = mix(col, u.color, smoothstep(0.015, 0.0, ring_dist));
                                }
                                if (dist < radius * 0.5) {
                                    let shine = dot(normalize(p - center_draw), vec2f(0.5, -0.5));
                                    col = mix(col, vec3f(0.2) + shine*0.1, smoothstep(radius*0.5, radius*0.5 - 0.01, dist));
                                    
                                    let ang = mix(-2.4, 2.4, val) - 1.5708;
                                    let dir = vec2f(cos(ang), sin(ang));
                                    let delta = p - center_draw;
                                    let proj = dot(delta, dir);
                                    if (proj > 0.0 && proj < radius*0.45 && length(delta - dir * proj) < 0.005) {
                                         col = vec3f(1.0);
                                    }
                                }
                            }
                        }
                        return vec4f(col, 1.0);
                    }
                `;

                    const module = device.createShaderModule({ code: shaderCode });
                    pipeline = device.createRenderPipeline({
                        layout: 'auto',
                        vertex: { module, entryPoint: 'vs_main' },
                        fragment: { module, entryPoint: 'fs_main', targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }] },
                        primitive: { topology: 'triangle-list' }
                    });

                    uniformBuffer = device.createBuffer({ size: 320, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
                    render();
                } catch (e) { console.error("WebGPU Init Failed", e); }
            };

            const render = () => {
                if (!isActive || !device || !pipeline) return;

                const vals = new Float32Array(12);
                const positions = new Float32Array(48); // 12 knobs * 4 floats each
                controlsRef.current.forEach((c, i) => {
                    if (i < 12) {
                        vals[i] = c.value;
                        const o = i * 4;
                        positions[o] = c.x; positions[o + 1] = c.y; positions[o + 2] = c.size;
                    }
                });

                const width = canvas.width, height = canvas.height;
                device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([performance.now() / 1000, width / height, 0, 0]));
                device.queue.writeBuffer(uniformBuffer, 16, new Float32Array([...colorHex, 0]));
                // vals: 12 floats = 3 vec4f, padded to 4 vec4f (16 floats)
                const valsWithPad = new Float32Array(16);
                valsWithPad.set(vals);
                device.queue.writeBuffer(uniformBuffer, 32, valsWithPad);
                device.queue.writeBuffer(uniformBuffer, 96, positions);

                const encoder = device.createCommandEncoder();
                const pass = encoder.beginRenderPass({
                    colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: 'store' }]
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

            init();

            return () => {
                isActive = false;
                if (animationId) cancelAnimationFrame(animationId);
                if (device) device.destroy(); // <--- CRITICAL FIX: Destroys GPU device on unmount
            };
        }, [colorHex]);

        return (
            <div ref={containerRef} className="relative rounded-lg shadow-xl overflow-hidden bg-gray-900 border border-gray-700" style={{ width: '100%', height: '100%', minHeight: '220px' }}>
                <canvas ref={canvasRef} width={800} height={400} className="w-full h-full block" />
                <div className="absolute inset-0 pointer-events-none">
                    <div className="absolute top-2 left-4 text-xs font-orbitron font-bold text-white/50 tracking-widest border-b border-white/20 pb-1 w-1/3">{title.toUpperCase()}</div>
                    {controls.map((c) => (
                        <div key={c.id} className="absolute text-center transform -translate-x-1/2" style={{ left: `${c.x * 100}%`, top: `${(c.y + c.size * 0.8) * 100}%`, color: `rgba(${colorHex[0] * 255},${colorHex[1] * 255},${colorHex[2] * 255},0.8)` }}>
                            <span className="text-[10px] font-mono font-bold tracking-wider drop-shadow-md">{c.label}</span>
                            <div className="text-[9px] opacity-60 font-mono">{Math.round(c.value * 100)}</div>
                        </div>
                    ))}
                    {onRecordToggle && controls.map((c) => (
                        <button key={`rec-${c.id}`} onClick={(e) => { e.stopPropagation(); onRecordToggle(c.id); }} className="absolute pointer-events-auto transform -translate-x-1/2" style={{ left: `${c.x * 100}%`, top: `${(c.y - c.size * 1.3) * 100}%`, width: '16px', height: '16px' }} title="Record Automation">
                            <div className={`w-full h-full rounded-full flex items-center justify-center text-[10px] font-bold ${c.isRecording ? 'bg-red-600 text-white animate-pulse' : 'bg-gray-800 text-red-500 border border-red-900/50 hover:bg-red-900/30'}`}>R</div>
                        </button>
                    ))}
                </div>
                {children && <div className="absolute inset-0 pointer-events-none">{children}</div>}
            </div>
        );
    });