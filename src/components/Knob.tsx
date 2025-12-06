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
  
  // Rotation: -135deg (min) to +135deg (max) -> Total 270deg range
  const rotation = -135 + (percentage * 270);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    const dy = dragStartY - e.clientY;
    const sensitivity = (max - min) / 200; 
    let newValue = dragStartValue + dy * sensitivity;
    
    // Snap to step
    newValue = Math.round(newValue / step) * step;
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
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentage * 0.75) * circumference; // 0.75 because we only want 270 degrees
  
  // Rotate the SVG circle to start at -135 degrees (bottom left)
  // 270 degree arc typically leaves a 90 degree gap at the bottom.
  // We rotate the entire SVG group to align the gap at the bottom.

  return (
    <div className="flex flex-col items-center space-y-2 select-none group" aria-label={`${label}: ${value.toFixed(2)}`}>
      <div 
        ref={knobRef}
        onMouseDown={handleMouseDown}
        className="relative w-16 h-16 cursor-ns-resize"
      >
        {/* Background Track SVG */}
        <svg className="absolute inset-0 w-full h-full rotate-90" viewBox="0 0 64 64">
          {/* Background Ring */}
          <circle
            cx="32" cy="32" r={radius}
            fill="none"
            stroke="#374151" // gray-700
            strokeWidth="4"
            strokeDasharray={`${circumference * 0.75} ${circumference * 0.25}`}
            strokeLinecap="round"
            className="transform rotate-[135deg] origin-center"
          />
          {/* Value Ring (Progress) */}
          <circle
            cx="32" cy="32" r={radius}
            fill="none"
            stroke={themeColors[color].stroke}
            strokeWidth="4"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transform rotate-[135deg] origin-center transition-all duration-75"
            style={{ filter: `drop-shadow(0 0 2px ${themeColors[color].stroke})` }}
          />
        </svg>

        {/* The Knob Cap */}
        <div 
          className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-gradient-to-br from-gray-700 to-gray-900 border border-gray-600 shadow-lg ${isDragging ? 'scale-95' : ''} transition-transform duration-100 ease-out`}
          style={{ transform: `translate(-50%, -50%) rotate(${rotation}deg)` }}
        >
           {/* Metallic/Shadow finish overlay */}
           <div className="absolute inset-0 rounded-full bg-gradient-to-br from-white/10 to-transparent pointer-events-none"></div>
           
           {/* Indicator Line */}
           <div className={`absolute top-1 left-1/2 -translate-x-1/2 w-1 h-3 rounded-full ${themeColors[color].glow}`} style={{ backgroundColor: themeColors[color].stroke }}></div>
        </div>
      </div>

      <div className="text-center -mt-1">
        <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{label}</div>
        <div className={`text-xs font-mono font-medium ${isDragging ? 'text-white' : 'text-gray-400'}`}>
          {formatValue(value)}<span className="text-[10px] text-gray-600 ml-0.5">{unit !== 'Hz' && unit !== 's' ? unit : ''}</span>
        </div>
      </div>
    </div>
  );
};