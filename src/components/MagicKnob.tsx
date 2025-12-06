import React, { useRef, useEffect } from 'react';
import bezelImg from './assets/knob-bezel.png';
import { useWebGPU } from '../gpu/WebGPUContext';
import { useWebGPUCanvas } from '../gpu/hooks/useWebGPUCanvas';
import { HOLOGRAPHIC_SHADER } from '../gpu/shaders/holographic.wgsl';

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
    // Use centralized WebGPU context
    const { device } = useWebGPU();
    const { context, format, isReady } = useWebGPUCanvas(canvasRef);

    useEffect(() => {
        if (!isReady || !device || !context || !format) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        console.log('MagicKnob: Initializing WebGPU renderer');

        let pipeline: GPURenderPipeline | null = null;
        let uniformBuffer: GPUBuffer | null = null;
        let animationId: number;

        try {
            // Create shader module using imported shader
            const module = device.createShaderModule({ code: HOLOGRAPHIC_SHADER });
            
            // Create render pipeline
            pipeline = device.createRenderPipeline({
                layout: 'auto',
                vertex: { module, entryPoint: 'vs_main' },
                fragment: { module, entryPoint: 'fs_main', targets: [{ format }] },
                primitive: { topology: 'triangle-list' }
            });

            // Create uniform buffer
            uniformBuffer = device.createBuffer({
                size: 32,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
            });

            console.log('MagicKnob: Pipeline created successfully');
        } catch (error) {
            console.error('MagicKnob: Error creating pipeline:', error);
            return;
        }

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

        render();
        
        return () => {
            if (animationId) cancelAnimationFrame(animationId);
        };
    }, [device, context, format, isReady, min, max]);

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
