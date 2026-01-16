import React, { useState, useRef, useEffect, useCallback } from 'react';

interface KnobProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  color?: 'cyan' | 'pink' | 'yellow' | 'purple' | 'red' | 'green';
  unit?: string;
  logarithmic?: boolean;
}

export const Knob: React.FC<KnobProps> = ({ label, value, onChange, min, max, step = 1, color = 'cyan', unit = '', logarithmic = false }) => {
  const knobRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartY, setDragStartY] = useState(0);
  const [dragStartValue, setDragStartValue] = useState(0);

  const valueToRotation = useCallback((val: number) => {
    let percentage;
    if (logarithmic) {
      const logMin = Math.log(min || 0.001);
      const logMax = Math.log(max);
      const logVal = Math.log(val || 0.001);
      percentage = (logVal - logMin) / (logMax - logMin);
    } else {
      percentage = (val - min) / (max - min);
    }
    return -135 + percentage * 270;
  }, [min, max, logarithmic]);

  const rotation = valueToRotation(value);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    const dy = dragStartY - e.clientY;
    const sensitivity = (max - min) / 200; // 200px drag for full range
    let newValue = dragStartValue + dy * sensitivity;
    
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
      document.body.style.cursor = 'grabbing';
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
    knobRef.current?.focus();
    setIsDragging(true);
    setDragStartY(e.clientY);
    setDragStartValue(value);
    document.body.style.cursor = 'ns-resize';
  };

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const direction = e.deltaY > 0 ? -1 : 1; // normalize: up increases
    let newValue = value + direction * step;
    newValue = Math.round(newValue / step) * step;
    newValue = Math.max(min, Math.min(max, newValue));
    onChange(newValue);
  }, [step, value, min, max, onChange]);

  const formatValue = (val: number) => {
    // Special case: milliseconds
    if (unit === 's' && val < 1) return `${(val * 1000).toFixed(0)}ms`;

    // Special case: kilohertz
    if (unit === 'Hz' && val >= 1000) return `${(val / 1000).toFixed(1)}k`;

    // Standard formatting
    let formatted: string;
    if (val >= 10 || val === 0) formatted = val.toFixed(0);
    else if (val < 0.1) formatted = val.toFixed(3);
    else formatted = val.toFixed(2);

    // Append unit if it exists (always, unless handled by special cases above)
    return `${formatted}${unit || ''}`;
  };

  const colorClasses = {
    cyan: 'bg-cyan-500',
    pink: 'bg-pink-500',
    yellow: 'bg-yellow-500',
    purple: 'bg-purple-500',
    red: 'bg-red-500',
    green: 'bg-green-500',
  };

  const focusBorderClasses = {
    cyan: 'focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400',
    pink: 'focus:border-pink-400 focus:ring-1 focus:ring-pink-400',
    yellow: 'focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400',
    purple: 'focus:border-purple-400 focus:ring-1 focus:ring-purple-400',
    red: 'focus:border-red-400 focus:ring-1 focus:ring-red-400',
    green: 'focus:border-green-400 focus:ring-1 focus:ring-green-400',
  };

  return (
    <div className="flex flex-col items-center space-y-1">
      <div
        ref={knobRef}
        className={`w-16 h-16 bg-gray-700 rounded-full flex items-center justify-center cursor-pointer select-none border-2 border-gray-600 focus:outline-none ${focusBorderClasses[color]}`}
        tabIndex={0}
        title={label}
        aria-label={label}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
            e.preventDefault();
            const newVal = Math.max(min, Math.min(max, Math.round((value + step) / step) * step));
            onChange(newVal);
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
            e.preventDefault();
            const newVal = Math.max(min, Math.min(max, Math.round((value - step) / step) * step));
            onChange(newVal);
          }
        }}
        onMouseDown={handleMouseDown}
        onWheel={handleWheel}
        role="slider"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={formatValue(value)}
        aria-orientation="vertical"
      >
        <div
          className="w-12 h-12 bg-gray-800 rounded-full relative shadow-inner"
          style={{
            transform: `rotate(${rotation}deg)`,
            transition: isDragging ? 'none' : 'transform 0.3s ease-out'
          }}
        >
          <div className={`absolute top-1 left-1/2 -translate-x-1/2 w-1 h-3 rounded-full ${colorClasses[color]}`}></div>
        </div>
      </div>
      <span className="text-xs text-gray-400 uppercase tracking-wider">{label}</span>
      <span className="text-sm font-mono text-gray-300">{formatValue(value)}</span>
    </div>
  );
};
