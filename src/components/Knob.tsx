import React, { useState, useRef, useEffect, useCallback } from 'react';

interface KnobProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  color?: 'cyan' | 'pink' | 'yellow';
  unit?: string;
  logarithmic?: boolean;
}

export const Knob: React.FC<KnobProps> = ({ label, value, onChange, min, max, step = 1, color = 'cyan', unit = '', logarithmic = false }) => {
  const knobRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartY, setDragStartY] = useState(0);
  const [dragStartValue, setDragStartValue] = useState(0);

  // Calculate percentage (0 to 1) for the gauge
  const getPercentage = useCallback((val: number) => {
    if (logarithmic) {
      const logMin = Math.log(min || 0.001);
      const logMax = Math.log(max);
      const logVal = Math.log(val || 0.001);
      return (logVal - logMin) / (logMax - logMin);
    }
    return (val - min) / (max - min);
  }, [min, max, logarithmic]);

  const percentage = Math.min(1, Math.max(0, getPercentage(value)));
  
  // Knob Rotation: -135deg (min) to +135deg (max) -> Total 270deg range
  const rotation = -135 + (percentage * 270);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    const dy = dragStartY - e.clientY;
    const sensitivity = (max - min) / 200; // 200px drag for full range
    let newValue = dragStartValue + dy * sensitivity;
    
    // Snap to step
    if (step) {
        newValue = Math.round(newValue / step) * step;
    }
    newValue = Math.max(min, Math.min(max, newValue));
    
    onChange(newValue);
  }, [isDragging, dragStartY, dragStartValue, min, max, step, onChange]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    document.body.style.cursor = 'default';
  }, []);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    } else {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    setDragStartY(e.clientY);
    setDragStartValue(value);
    document.body.style.cursor = 'ns-resize';
  };

  const formatValue = (val: number) => {
    if (unit === 's' && val < 1) return `${(val * 1000).toFixed(0)}ms`;
    if (unit === 'Hz' && val >= 1000) return `${(val / 1000).toFixed(1)}k`;
    if (val >= 10 || val === 0) return val.toFixed(0);
    if (val < 0.1) return val.toFixed(3);
    return val.toFixed(2);
  };

  const themeColors = {
    cyan: { stroke: '#06b6d4', glow: 'shadow-[0_0_10px_rgba(6,182,212,0.5)]' },
    pink: { stroke: '#ec4899', glow: 'shadow-[0_0_10px_rgba(236,72,153,0.5)]' },
    yellow: { stroke: '#eab308', glow: 'shadow-[0_0_10px_rgba(234,179,8,0.5)]' },
  };

  // SVG Gauge Math
  const radius = 26; // Slightly smaller radius to fit padding safely
  const circumference = 2 * Math.PI * radius;
  const strokeDasharray = `${circumference} ${circumference}`;
  // We want a 270 degree arc. 270/360 = 0.75.
  // The gap should be 0.25 * C.
  // To make the gap appear at the bottom, we rotate the circle.
  // Standard circle starts at 3 o'clock. We want start at -135deg (7:30).
  const offset = circumference - (percentage * 0.75) * circumference;

  return (
    <div className="flex flex-col items-center space-y-1 select-none group w-full" aria-label={`${label}: ${value.toFixed(2)}`}>
      <div 
        ref={knobRef}
        onMouseDown={handleMouseDown}
        className="relative w-14 h-14 cursor-ns-resize flex-shrink-0"
      >
        {/* Background Track SVG */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 64 64">
          {/* Background Ring (Dark Grey) */}
          <circle
            cx="32" cy="32" r={radius}
            fill="none"
            stroke="#374151" // gray-700
            strokeWidth="5"
            strokeDasharray={`${circumference * 0.75} ${circumference * 0.25}`}
            strokeLinecap="round"
            transform="rotate(135 32 32)"
          />
          {/* Value Ring (Colored) */}
          <circle
            cx="32" cy="32" r={radius}
            fill="none"
            stroke={themeColors[color].stroke}
            strokeWidth="5"
            strokeDasharray={strokeDasharray}
            strokeDashoffset={offset}
            strokeLinecap="round"
            transform="rotate(135 32 32)"
            style={{ filter: `drop-shadow(0 0 2px ${themeColors[color].stroke})` }}
          />
        </svg>

        {/* The Knob Cap */}
        <div 
          className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-gray-800 border-2 border-gray-600 shadow-md ${isDragging ? 'scale-95 border-gray-500' : ''} transition-transform duration-75 ease-out`}
          style={{ transform: `translate(-50%, -50%) rotate(${rotation}deg)` }}
        >
           {/* Indicator Line */}
           <div className={`absolute top-0.5 left-1/2 -translate-x-1/2 w-1 h-2.5 rounded-full ${themeColors[color].glow}`} style={{ backgroundColor: themeColors[color].stroke }}></div>
        </div>
      </div>

      <div className="text-center w-full">
        <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest truncate px-1">{label}</div>
        <div className={`text-xs font-mono font-medium leading-none mt-0.5 ${isDragging ? 'text-white' : 'text-gray-400'}`}>
          {formatValue(value)}{unit && unit !== 'Hz' && unit !== 's' ? <span className="text-[9px] text-gray-600 ml-0.5">{unit}</span> : ''}
        </div>
      </div>
    </div>
  );
};