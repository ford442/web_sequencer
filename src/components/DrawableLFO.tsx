import React, { useRef, useState, useEffect, useCallback } from 'react';

interface DrawableLFOProps {
    value?: number[]; // Array of values from 0 to 1 (0.5 = neutral)
    onChange: (shape: number[]) => void;
    width?: number;
    height?: number;
    resolution?: number; // Number of points in the array
    color?: string;
    label?: string;
}

// ⚡ Bolt: Added React.memo to prevent unnecessary re-renders when parent state changes.
export const DrawableLFO: React.FC<DrawableLFOProps> = React.memo(({
    value,
    onChange,
    width = 120,
    height = 60,
    resolution = 64,
    color = '#4ade80', // Green-400 (from main)
    label = 'Custom LFO'
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);

    // Local state for smooth drawing
    const [localShape, setLocalShape] = useState<number[]>(() => {
        if (value && value.length === resolution) return [...value];
        // Default to flat line at 0.5
        return Array.from({ length: resolution }, () => 0.5);
    });

    // Sync external value when not drawing
    useEffect(() => {
        if (!isDrawing && value && value.length === resolution) {
            setLocalShape([...value]);
        }
    }, [value, resolution, isDrawing]);

    const drawCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, width, height);

        // Center line
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();

        // Waveform
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();

        for (let i = 0; i < resolution; i++) {
            const x = (i / (resolution - 1)) * width;
            // Map 0-1 to Y (1.0 = top, 0.0 = bottom, like main)
            const y = (1 - localShape[i]) * height;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Fill
        ctx.fillStyle = `${color}33`;
        ctx.lineTo(width, height);
        ctx.lineTo(0, height);
        ctx.closePath();
        ctx.fill();
    }, [localShape, width, height, resolution, color]);

    useEffect(() => drawCanvas(), [drawCanvas]);

    const updatePoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const clampedX = Math.max(0, Math.min(width, x));
        const clampedY = Math.max(0, Math.min(height, y));
        const index = Math.floor((clampedX / width) * resolution);
        const safeIndex = Math.min(resolution - 1, index);
        // Map Y to 0-1 (1 = top, 0 = bottom)
        const val = 1 - (clampedY / height);
        setLocalShape(prev => {
            const next = [...prev];
            next[safeIndex] = val;
            return next;
        });
    };

    const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
        setIsDrawing(true);
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        updatePoint(e);
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!isDrawing) return;
        updatePoint(e);
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
        setIsDrawing(false);
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        onChange(localShape);
    };

    const resetToFlat = () => {
        const flat = Array.from({ length: resolution }, () => 0.5);
        setLocalShape(flat);
        onChange(flat);
    };

    return (
        <div className="flex flex-col items-center gap-1 p-2 bg-gray-900/50 rounded border border-gray-700/50">
            <div className="flex justify-between w-full items-center px-1">
                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">{label}</span>
                <button
                    onClick={resetToFlat}
                    className="text-[9px] text-gray-500 hover:text-green-400 transition-colors"
                    aria-label="Reset to Flat"
                    title="Reset to Flat"
                    type="button"
                >
                    RESET
                </button>
            </div>
            <canvas
                ref={canvasRef}
                width={width}
                height={height}
                className="bg-gray-950 rounded border border-gray-800 cursor-crosshair touch-none"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                title="Draw custom LFO shape"
            />
        </div>
    );
});