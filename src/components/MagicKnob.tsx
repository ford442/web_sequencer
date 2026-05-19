import React, { useRef, useEffect } from 'react';
import bezelImg from './assets/knob-bezel.png';
import { KnobGPUContext } from './KnobGPUContext';

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

        const handle = KnobGPUContext.register(canvas, () => (valueRef.current - min) / (max - min));
        return () => {
            KnobGPUContext.unregister(handle);
        };
    }, [min, max]); // Re-init if range changes

    const displayValue = Math.round(value * 100) / 100;

    return (
        <div
            className="flex flex-col items-center select-none"
            style={{ cursor: 'pointer' }}
            tabIndex={0}
            role="slider"
            aria-label={label}
            aria-orientation="vertical"
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={displayValue}
            aria-valuetext={`${displayValue}`}
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
