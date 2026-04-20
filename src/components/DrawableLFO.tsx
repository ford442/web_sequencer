import React, { useRef, useState, useEffect, useCallback } from 'react';

interface DrawableLFOProps {
    value?: number[]; // Array of values from -1 to 1
    onChange: (shape: number[]) => void;
    width?: number;
    height?: number;
    resolution?: number; // Number of points in the array
    color?: string;
    label?: string;
}

export const DrawableLFO: React.FC<DrawableLFOProps> = ({
    value,
    onChange,
    width = 120,
    height = 60,
    resolution = 64,
    color = '#818cf8', // Indigo-400
    label = 'Custom LFO'
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);

    // Internal state array to avoid rendering lag
    const [localShape, setLocalShape] = useState<number[]>(() => {
        if (value && value.length === resolution) return [...value];
        // Default to a sine wave if nothing is provided
        return Array.from({ length: resolution }, (_, i) => Math.sin((i / resolution) * Math.PI * 2));
    });

    // Sync external value when it changes (and we're not actively drawing)
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

        // Draw center line
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();

        // Draw waveform
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();

        for (let i = 0; i < resolution; i++) {
            const x = (i / (resolution - 1)) * width;
            // Map value (-1 to 1) to y coordinate (height to 0)
            const val = localShape[i];
            const y = height / 2 - (val * (height / 2)) * 0.9; // 0.9 padding

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();

        // Fill area
        ctx.fillStyle = `${color}33`; // Add transparency to hex
        ctx.lineTo(width, height / 2);
        ctx.lineTo(0, height / 2);
        ctx.closePath();
        ctx.fill();

    }, [localShape, width, height, resolution, color]);

    useEffect(() => {
        drawCanvas();
    }, [drawCanvas]);

    const updatePoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Ensure within bounds
        const clampedX = Math.max(0, Math.min(width, x));
        const clampedY = Math.max(0, Math.min(height, y));

        // Map to array index
        const index = Math.floor((clampedX / width) * resolution);
        const safeIndex = Math.min(resolution - 1, index);

        // Map Y to value (-1 to 1)
        // Adjust for padding used in drawing (0.9 multiplier)
        let val = (height / 2 - clampedY) / ((height / 2) * 0.9);
        val = Math.max(-1, Math.min(1, val)); // Clamp strictly to -1 to 1

        setLocalShape(prev => {
            const next = [...prev];
            next[safeIndex] = val;

            // Smoothing/Interpolation could go here if moving cursor fast,
            // but for simplicity we just update the point.

            return next;
        });
    };

    const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setIsDrawing(true);
        updatePoint(e);
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!isDrawing) return;
        updatePoint(e);
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!isDrawing) return;
        setIsDrawing(false);
        e.currentTarget.releasePointerCapture(e.pointerId);
        // Only trigger onChange when done drawing to save performance
        onChange(localShape);
    };

    const resetToSine = () => {
        const sine = Array.from({ length: resolution }, (_, i) => Math.sin((i / resolution) * Math.PI * 2));
        setLocalShape(sine);
        onChange(sine);
    };

    return (
        <div className="flex flex-col items-center gap-1 p-2 bg-gray-900/50 rounded border border-gray-700/50">
            <div className="flex justify-between w-full items-center px-1">
                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">{label}</span>
                <button
                    onClick={resetToSine}
                    className="text-[9px] text-gray-500 hover:text-indigo-400 transition-colors"
                    title="Reset to Sine Wave"
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
                title="Draw custom LFO waveform"
            />
        </div>
    );
};