import React, { useRef, useEffect } from 'react';

export interface KnobConfig {
    id: string;
    label: string;
    x: number;
    y: number;
    size: number;
    value: number;
    isRecording?: boolean;
    valueDisplay?: string;
}

interface HardwareModuleProps {
    title: string;
    colorHex: [number, number, number];
    controls: KnobConfig[];
    onParamChange: (id: string, value: number) => void;
    onRecordToggle?: (id: string) => void;
    children?: React.ReactNode;
    is3D?: boolean; // Enable holographic shader in 3D mode
}

export const HardwareModule = React.memo(
    ({
        title,
        colorHex,
        controls,
        onParamChange,
        onRecordToggle,
        children,
        is3D = false
    }: HardwareModuleProps) => {
        const canvasRef = useRef<HTMLCanvasElement>(null);
        const containerRef = useRef<HTMLDivElement>(null);
        const controlsRef = useRef(controls);
        const colorHexRef = useRef(colorHex); // PERFORMANCE: Track color changes without re-init
        const activeKnobIndex = useRef<number | null>(null);
        const startY = useRef(0);
        const startVal = useRef(0);

        // Ref to store the render function for demand-based rendering
        const renderRef = useRef<(() => void) | null>(null);

        // Refs for accessibility elements to enable focus management
        const sliderRefs = useRef<(HTMLDivElement | null)[]>([]);

        // Sync refs
        useEffect(() => {
            controlsRef.current = controls;
            // Optimization: In 3D mode, the animation loop handles rendering.
            // Avoid redundant render calls to prevent double-work per frame.
            if (!is3D && renderRef.current) renderRef.current();
        }, [controls, is3D]);

        useEffect(() => {
            colorHexRef.current = colorHex;
            if (!is3D && renderRef.current) renderRef.current();
        }, [colorHex, is3D]);

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

                    // UX IMPROVEMENT: Focus the accessible slider when clicking the visual knob
                    // This allows users to click to select, then use arrow keys for fine-tuning
                    sliderRefs.current[hitIndex]?.focus();
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
            let bindGroup: GPUBindGroup; // Performance: Reuse bindGroup
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
                    // Two shader modes: standard and holographic (3D mode)
                    const shaderCode = is3D ? `
                    // HOLOGRAPHIC SHADER FOR 3D MODE
                    struct Uniforms {
                        time: f32, ratio: f32, pad1: f32, pad2: f32,
                        color: vec3f, pad3: f32,
                        vals1: vec4f, vals2: vec4f, vals3: vec4f,
                        pad4: vec4f,
                        pos: array<vec4f, 12>,
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

                    fn rotate(angle: f32) -> mat2x2f {
                        let c = cos(angle);
                        let s = sin(angle);
                        return mat2x2f(c, -s, s, c);
                    }

                    @fragment
                    fn fs_main(in: VertexOutput) -> @location(0) vec4f {
                        var uv = in.uv * 0.5 + 0.5; 
                        uv.y = 1.0 - uv.y;
                        var p = uv; p.x = p.x * u.ratio;

                        // Dark background with subtle grain
                        var col = vec3f(0.08, 0.1, 0.12);
                        col += (fract(sin(dot(uv, vec2f(12.9898, 78.233))) * 43758.5453) * 0.02);
                        
                        // Holographic scanlines
                        let scanline = sin(uv.y * 300.0 + u.time * 8.0) * 0.5 + 0.5;
                        col *= 0.92 + 0.08 * scanline;

                        for (var i = 0; i < 12; i++) {
                            let k_pos_uv = u.pos[i];
                            if (k_pos_uv.z == 0.0) { continue; }

                            let center_draw = vec2f(k_pos_uv.x * u.ratio, k_pos_uv.y);
                            let delta = p - center_draw;
                            let dist = length(delta);
                            let radius = k_pos_uv.z;
                            let val = get_knob_val(i);

                            if (dist < radius * 1.2) {
                                // Outer glow/halo effect
                                let halo = smoothstep(radius * 1.2, radius * 0.9, dist);
                                col += u.color * halo * 0.3 * (0.8 + 0.2 * sin(u.time * 3.0));

                                if (dist < radius) {
                                    // Rotating data ring
                                    let rot_delta = rotate(u.time * 0.5) * delta;
                                    let ring_dist = abs(length(rot_delta) - (radius * 0.85));
                                    let angle_rot = atan2(rot_delta.y, rot_delta.x);
                                    let dash = sin(angle_rot * 15.0);
                                    if (ring_dist < 0.01 && dash > 0.3) {
                                        col = mix(col, u.color * 1.5, smoothstep(0.01, 0.0, ring_dist));
                                    }

                                    // Inner holographic disc with fresnel
                                    if (dist < radius * 0.7) {
                                        let fresnel = pow(1.0 - (dist / (radius * 0.7)), 2.0);
                                        col = mix(col, u.color * 0.3, 0.4 * fresnel);
                                        
                                        // Holographic shimmer
                                        let shimmer = sin(dist * 100.0 - u.time * 10.0) * 0.5 + 0.5;
                                        col += u.color * shimmer * 0.15 * fresnel;
                                    }

                                    // Value indicator needle with glow
                                    let ang = mix(-2.4, 2.4, val) - 1.5708;
                                    let dir = vec2f(cos(ang), sin(ang));
                                    let proj = dot(delta, dir);
                                    let perp_dist = length(delta - dir * proj);
                                    
                                    if (proj > 0.0 && proj < radius * 0.6 && perp_dist < 0.015) {
                                        let needle_glow = 1.0 / (perp_dist * 80.0 + 1.0);
                                        col = mix(col, vec3f(1.0, 1.0, 1.0), needle_glow * 0.8);
                                        col += u.color * needle_glow * 0.5;
                                    }
                                }
                            }
                        }
                        
                        // Holographic glitch effect (occasional)
                        let glitch = step(0.97, sin(u.time * 15.0 + p.x * 50.0));
                        if (glitch > 0.5) {
                            col += u.color * 0.2 * (sin(u.time * 100.0) * 0.5 + 0.5);
                        }

                        return vec4f(col, 1.0);
                    }
                ` : `
                    // STANDARD SHADER FOR 2D MODE
                    struct Uniforms {
                        time: f32, ratio: f32, pad1: f32, pad2: f32,
                        color: vec3f, pad3: f32,
                        vals1: vec4f, vals2: vec4f, vals3: vec4f,
                        pad4: vec4f,
                        pos: array<vec4f, 12>,
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
                            let k_pos_uv = u.pos[i];
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

                    // Optimization: Create BindGroup once
                    bindGroup = device.createBindGroup({
                        layout: pipeline.getBindGroupLayout(0),
                        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
                    });

                    // Assign render function for external calls
                    renderRef.current = render;

                    // Initial render
                    render();

                    // Start animation loop for holographic effects in 3D mode
                    if (is3D) {
                        const loop = () => {
                            if (!isActive) return;
                            render();
                            animationFrameId = requestAnimationFrame(loop);
                        };
                        animationFrameId = requestAnimationFrame(loop);
                    }
                } catch (e) { console.error("WebGPU Init Failed", e); }
            };

            let animationFrameId: number;

            // Pre-allocate buffers to avoid garbage collection in the render loop
            // Optimization: Single staging buffer for batched upload
            // Size: 288 bytes / 4 = 72 floats (matches struct size exactly)
            // Layout:
            // 0-3: Time (vec4: time, ratio, pad, pad)
            // 4-7: Color (vec4: r, g, b, pad)
            // 8-23: Vals (vec4[4]: 16 floats, padded)
            // 24-71: Positions (vec4[12]: 48 floats)
            const stagingBuffer = new Float32Array(72);

            const render = () => {
                if (!isActive || !device || !pipeline || !bindGroup) return;

                const width = canvas.width, height = canvas.height;

                // Clear dynamic regions (Vals and Positions) to ensure clean state
                // Vals: indices 8 to 23 (16 floats)
                // Positions: indices 24 to 71 (48 floats)
                stagingBuffer.fill(0, 8, 72);

                // 1. Update Time Uniform [0-3]
                stagingBuffer[0] = performance.now() / 1000;
                stagingBuffer[1] = width / height;

                // 2. Update Color Uniform [4-7]
                const c = colorHexRef.current;
                stagingBuffer[4] = c[0];
                stagingBuffer[5] = c[1];
                stagingBuffer[6] = c[2];

                // 3. Update Controls (Vals and Positions)
                controlsRef.current.forEach((ctrl, i) => {
                    if (i < 12) {
                        // Vals start at index 8
                        stagingBuffer[8 + i] = ctrl.value;

                        // Positions start at index 24, stride 4
                        const posOffset = 24 + (i * 4);
                        stagingBuffer[posOffset] = ctrl.x;
                        stagingBuffer[posOffset + 1] = ctrl.y;
                        stagingBuffer[posOffset + 2] = ctrl.size;
                        // posOffset + 3 (radius/pad) is already 0 from fill
                    }
                });

                // PERFORMANCE: Single batched write instead of 4 separate calls
                device.queue.writeBuffer(uniformBuffer, 0, stagingBuffer);

                const encoder = device.createCommandEncoder();
                const pass = encoder.beginRenderPass({
                    colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: 'store' }]
                });
                pass.setPipeline(pipeline);
                pass.setBindGroup(0, bindGroup);
                pass.draw(3);
                pass.end();
                device.queue.submit([encoder.finish()]);
            };

            init();

            return () => {
                isActive = false;
                if (animationFrameId) cancelAnimationFrame(animationFrameId);
                renderRef.current = null;
                if (device) device.destroy(); // <--- CRITICAL FIX: Destroys GPU device on unmount
            };
        }, [is3D]); // Re-initialize when switching between 2D and 3D mode

        return (
            <div ref={containerRef} className="relative rounded-lg shadow-xl overflow-hidden bg-gray-900 border border-gray-700" style={{ width: '100%', height: '100%', minHeight: '220px' }}>
                <canvas ref={canvasRef} width={800} height={400} className="w-full h-full block" />
                <div className="absolute inset-0 pointer-events-none">
                    <div className="absolute top-2 left-4 text-xs font-orbitron font-bold text-white/50 tracking-widest border-b border-white/20 pb-1 w-1/3">{title.toUpperCase()}</div>
                    {controls.map((c) => (
                        <div key={c.id} className="absolute text-center transform -translate-x-1/2" style={{ left: `${c.x * 100}%`, top: `${(c.y + c.size * 0.8) * 100}%`, color: `rgba(${colorHex[0] * 255},${colorHex[1] * 255},${colorHex[2] * 255},0.8)` }}>
                            <span className="text-[10px] font-mono font-bold tracking-wider drop-shadow-md">{c.label}</span>
                            <div className="text-[9px] opacity-60 font-mono">{c.valueDisplay ?? Math.round(c.value * 100)}</div>
                        </div>
                    ))}
                    {onRecordToggle && controls.map((c) => (
                        <button
                            key={`rec-${c.id}`}
                            onClick={(e) => { e.stopPropagation(); onRecordToggle(c.id); }}
                            className="absolute pointer-events-auto transform -translate-x-1/2"
                            style={{ left: `${c.x * 100}%`, top: `${(c.y - c.size * 1.3) * 100}%`, width: '16px', height: '16px' }}
                            title="Record Automation"
                            aria-label={`Record Automation for ${c.label}`}
                        >
                            <div className={`w-full h-full rounded-full flex items-center justify-center text-[10px] font-bold ${c.isRecording ? 'bg-red-600 text-white animate-pulse' : 'bg-gray-800 text-red-500 border border-red-900/50 hover:bg-red-900/30'}`}>R</div>
                        </button>
                    ))}
                    {controls.map((c, i) => (
                        <div
                            key={`a11y-${c.id}`}
                            ref={(el) => { sliderRefs.current[i] = el; }}
                            role="slider"
                            aria-label={c.label}
                            aria-valuetext={c.valueDisplay}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={Math.round(c.value * 100)}
                            tabIndex={0}
                            className="absolute transform -translate-x-1/2 -translate-y-1/2 rounded-full focus:ring-2 focus:ring-white focus:outline-none pointer-events-none"
                            style={{
                                left: `${c.x * 100}%`,
                                top: `${c.y * 100}%`,
                                width: `${c.size * 200}%`,
                                height: `${c.size * 200}%`
                            }}
                            onKeyDown={(e) => {
                                let newVal = c.value;
                                let handled = false;
                                const isShift = e.shiftKey;
                                const isFine = e.altKey || e.ctrlKey || e.metaKey;
                                const step = isShift ? 0.2 : (isFine ? 0.005 : 0.05);

                                if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
                                    newVal += step;
                                    handled = true;
                                } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
                                    newVal -= step;
                                    handled = true;
                                } else if (e.key === 'PageUp') {
                                    newVal += 0.1;
                                    handled = true;
                                } else if (e.key === 'PageDown') {
                                    newVal -= 0.1;
                                    handled = true;
                                } else if (e.key === 'Home') {
                                    newVal = 0;
                                    handled = true;
                                } else if (e.key === 'End') {
                                    newVal = 1;
                                    handled = true;
                                }

                                if (handled) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    onParamChange(c.id, Math.max(0, Math.min(1, newVal)));
                                }
                            }}
                        />
                    ))}
                </div>
                {children && <div className="absolute inset-0 pointer-events-none">{children}</div>}
            </div>
        );
    });
