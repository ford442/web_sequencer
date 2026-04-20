import React, { useRef, useEffect, useState, useCallback } from 'react';

interface DrawableLFOProps {
  /** Number of discrete points in the wavetable (e.g., 64, 128) */
  resolution?: number;
  /** Array of normalized values (0.0 to 1.0) */
  value: number[];
  /** Fired when the user finishes drawing a stroke */
  onChange: (newValue: number[]) => void;
  width?: number;
  height?: number;
}

export const DrawableLFO: React.FC<DrawableLFOProps> = ({
  resolution = 128,
  value,
  onChange,
  width = 300,
  height = 100,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  // Local state for smooth drawing without forcing parent app re-renders
  const [localData, setLocalData] = useState<number[]>(
    value.length === resolution ? value : Array(resolution).fill(0.5)
  );

  // 1. Core Rendering Logic
  const drawToCanvas = useCallback((data: number[]) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    // Draw Center Zero-Crossing Line
    ctx.strokeStyle = '#374151'; // Tailwind gray-700
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    // Draw Custom LFO Waveform
    ctx.strokeStyle = '#4ade80'; // Tailwind green-400
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();

    const sliceWidth = width / (resolution - 1);

    for (let i = 0; i < resolution; i++) {
      const x = i * sliceWidth;
      const y = (1 - data[i]) * height; // Invert Y: 1.0 is top, 0.0 is bottom

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // Optional: Fill under the curve for a cool oscilloscope look
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fillStyle = '#4ade8033'; // Green with 20% opacity
    ctx.fill();

  }, [width, height, resolution]);

  // Re-draw whenever local data changes
  useEffect(() => {
    drawToCanvas(localData);
  }, [localData, drawToCanvas]);

  // 2. Interaction Logic
  const updateDataAtEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Constrain to canvas bounds
    const clampedX = Math.max(0, Math.min(width, x));
    const clampedY = Math.max(0, Math.min(height, y));

    // Map X pixel to array index
    const index = Math.floor((clampedX / width) * resolution);
    const safeIndex = Math.min(resolution - 1, index);

    // Map Y pixel to normalized value (0.0 - 1.0)
    const val = 1 - (clampedY / height);

    setLocalData(prev => {
      const newData = [...prev];
      newData[safeIndex] = val;
      // Note: For very fast mouse movements, you might want to add linear interpolation
      // between the last index and current index here to prevent "gaps" in the drawn line.
      return newData;
    });
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    setIsDrawing(true);
    // Capture pointer so drawing continues even if mouse briefly leaves canvas bounds
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    updateDataAtEvent(e);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    updateDataAtEvent(e);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    setIsDrawing(false);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    // Commit the final drawn shape to the parent application state
    onChange(localData);
  };

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-md overflow-hidden inline-block shadow-inner">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        // touch-none prevents the browser from scrolling the page while drawing on mobile!
        className="cursor-crosshair touch-none select-none"
        title="Draw custom LFO shape"
      />
    </div>
  );
};
