import React, { useRef, useEffect, useState } from 'react';
import { useWebGPU } from '../gpu/WebGPUContext';
import { useWebGPUCanvas } from '../gpu/hooks/useWebGPUCanvas';
import { HARDWARE_MODULE_SHADER } from '../gpu/shaders/hardwareModule.wgsl';

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
    /**
     * @deprecated No longer needed - WebGPU initialization is now centralized.
     * This parameter is kept for backward compatibility but has no effect.
     */
    initDelay?: number;
}

export const HardwareModule = React.memo(
    ({
        title,
        colorHex,
        controls,
        onParamChange,
        onRecordToggle,
        children,
    }: HardwareModuleProps) => {
        const canvasRef = useRef<HTMLCanvasElement>(null);
        const containerRef = useRef<HTMLDivElement>(null);

        // Use centralized WebGPU context
        const { device, isSupported, isInitialized } = useWebGPU();
        const { context, format, isReady } = useWebGPUCanvas(canvasRef);

        // Track if we should use Canvas 2D fallback
        const [useCanvas2D, setUseCanvas2D] = useState(false);

        // Refs to store mutable data for the render loop / event handlers
        const controlsRef = useRef(controls);
        const activeKnobIndex = useRef<number | null>(null);
        const startY = useRef(0);
        const startVal = useRef(0);

        // Sync latest props to ref
        useEffect(() => { controlsRef.current = controls; }, [controls]);

        // Determine if we should fall back to Canvas 2D
        useEffect(() => {
            if (isInitialized && !isSupported) {
                console.log(`HardwareModule [${title}]: WebGPU not supported, using Canvas 2D fallback`);
                setUseCanvas2D(true);
            }
        }, [isInitialized, isSupported, title]);

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
                    const dist = Math.sqrt(dx * dx + dy * dy);
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
            // Skip if we should use Canvas 2D fallback
            if (useCanvas2D) {
                console.log(`HardwareModule [${title}]: Using Canvas 2D fallback, skipping WebGPU setup`);
                return;
            }

            // Wait for WebGPU to be ready
            if (!isReady || !device || !context || !format) {
                return;
            }

            const canvas = canvasRef.current;
            if (!canvas) {
                console.log(`HardwareModule [${title}]: Canvas ref is null`);
                return;
            }

            console.log(`HardwareModule [${title}]: Initializing WebGPU renderer`);

            let pipeline: GPURenderPipeline | null = null;
            let uniformBuffer: GPUBuffer | null = null;
            let animationId: number | null = null;

            try {
                // Create shader module using imported shader
                const module = device.createShaderModule({ code: HARDWARE_MODULE_SHADER });
                
                // Create render pipeline
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

                console.log(`HardwareModule [${title}]: WebGPU pipeline created successfully`);
            } catch (error) {
                console.error(`HardwareModule [${title}]: Error creating pipeline, falling back to Canvas 2D:`, error);
                setUseCanvas2D(true);
                return;
            }

            const render = () => {
                if (!device || !context || !pipeline || !uniformBuffer) return;

                try {
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
                } catch (error) {
                    console.error(`HardwareModule [${title}]: WebGPU render error, falling back to Canvas 2D:`, error);
                    setUseCanvas2D(true);
                    if (animationId) cancelAnimationFrame(animationId);
                    animationId = null;
                }
            };

            // Start rendering
            render();

            return () => {
                console.log(`HardwareModule [${title}]: Cleaning up WebGPU renderer`);
                if (animationId) {
                    cancelAnimationFrame(animationId);
                    animationId = null;
                }
            };
        }, [device, context, format, isReady, colorHex, useCanvas2D, title]);

        // --- CANVAS 2D FALLBACK RENDERER ---
        useEffect(() => {
            if (!useCanvas2D) {
                return; // Only run if we should use Canvas 2D fallback
            }

            console.log(`HardwareModule [${title}]: Starting Canvas 2D fallback renderer`);
            const canvas = canvasRef.current;
            if (!canvas) {
                console.log('HardwareModule: Canvas ref is null');
                return;
            }

            const ctx = canvas.getContext('2d');
            if (!ctx) {
                console.log('HardwareModule: Could not get 2D context');
                return;
            }

            console.log('HardwareModule: Canvas 2D context obtained, starting render loop');
            let animationId: number;

            const render = () => {
                const width = canvas.width;
                const height = canvas.height;
                const currentControls = controlsRef.current;

                // Background
                ctx.fillStyle = '#1f2227';
                ctx.fillRect(0, 0, width, height);

                // Create accent color
                const accentR = Math.round(colorHex[0] * 255);
                const accentG = Math.round(colorHex[1] * 255);
                const accentB = Math.round(colorHex[2] * 255);
                const accentColor = `rgb(${accentR}, ${accentG}, ${accentB})`;

                // Draw each knob
                currentControls.forEach((knob) => {
                    const centerX = knob.x * width;
                    const centerY = knob.y * height;
                    const radius = knob.size * width;

                    // Knob bezel (dark circle)
                    ctx.beginPath();
                    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
                    ctx.fillStyle = '#0a0a0a';
                    ctx.fill();

                    // Value ring
                    const ringRadius = radius * 0.75;
                    ctx.beginPath();
                    ctx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
                    ctx.strokeStyle = accentColor;
                    ctx.lineWidth = 4;
                    ctx.stroke();

                    // Knob cap
                    const capRadius = radius * 0.5;
                    const gradient = ctx.createRadialGradient(
                        centerX - capRadius * 0.3, centerY - capRadius * 0.3, 0,
                        centerX, centerY, capRadius
                    );
                    gradient.addColorStop(0, '#404040');
                    gradient.addColorStop(1, '#1a1a1a');

                    ctx.beginPath();
                    ctx.arc(centerX, centerY, capRadius, 0, Math.PI * 2);
                    ctx.fillStyle = gradient;
                    ctx.fill();

                    // Indicator line
                    const angle = -Math.PI / 2 + (knob.value * Math.PI * 1.6) - (Math.PI * 0.8);
                    const lineEndX = centerX + Math.cos(angle) * capRadius * 0.8;
                    const lineEndY = centerY + Math.sin(angle) * capRadius * 0.8;

                    ctx.beginPath();
                    ctx.moveTo(centerX, centerY);
                    ctx.lineTo(lineEndX, lineEndY);
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 2;
                    ctx.stroke();
                });

                animationId = requestAnimationFrame(render);
            };

            render();

            return () => {
                if (animationId) cancelAnimationFrame(animationId);
            };
        }, [useCanvas2D, colorHex, title]); // controlsRef is updated separately, no need for controls dependency

        // Allow overlayed children (e.g., WaveformSelector) to be visible
        // when they extend outside the main canvas/module rectangle.
        // This avoids them being clipped by the module's border.
        return (
            <div
                ref={containerRef}
                className="relative rounded-lg shadow-xl overflow-visible bg-gray-900 border border-gray-700 min-h-[120px]"
                style={{ width: '100%', height: '100%' }}
            >
                {/* The WebGPU/Canvas 2D Surface */}
                <canvas
                    ref={canvasRef}
                    width={800}
                    height={400}
                    className="w-full h-full block z-0"
                />

                {/* HTML Overlay for Labels (Accessibility + Sharp Text) */}
                <div className="absolute inset-0 pointer-events-none z-10">
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
                                color: `rgba(${colorHex[0] * 255}, ${colorHex[1] * 255}, ${colorHex[2] * 255}, 0.8)`
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
                                className={`w-full h-full rounded-full flex items-center justify-center text-[10px] font-bold transition-all ${c.isRecording
                                    ? 'bg-red-600 text-white shadow-lg shadow-red-500/50 animate-pulse'
                                    : 'bg-gray-800 text-red-500 border border-red-900/50 hover:bg-red-900/30'
                                    }`}
                            >
                                R
                            </div>
                        </button>
                    ))}
                </div>

                {/* Custom Children (e.g., Waveform Selector) - rendered directly without extra wrapper */}
                {children}
            </div>
        );
    }
);
