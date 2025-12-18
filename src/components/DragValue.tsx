import React, { useEffect, useRef, useState } from 'react';

interface DragValueProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  className?: string;
}

export const DragValue: React.FC<DragValueProps> = ({ value, onChange, min = 0, max = 100, step = 1, label, className }) => {
  const [isDragging, setIsDragging] = useState(false);
  const startY = useRef(0);
  const startValue = useRef(value);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const dy = startY.current - e.clientY;
      const range = Math.max(1, max - min);
      const sensitivity = range / 200; // 200px for full range
      let newVal = startValue.current + dy * sensitivity;
      if (step > 0) newVal = Math.round(newVal / step) * step;
      newVal = Math.max(min, Math.min(max, newVal));
      onChange(newVal);
    };

    const onUp = () => {
      setIsDragging(false);
      document.body.style.cursor = 'default';
    };

    if (isDragging) {
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      document.body.style.cursor = 'ns-resize';
    }

    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isDragging, max, min, onChange, step]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const dir = e.deltaY > 0 ? -1 : 1;
    let newVal = value + dir * (step || 1);
    newVal = Math.round(newVal / step) * step;
    newVal = Math.max(min, Math.min(max, newVal));
    onChange(newVal);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    startY.current = e.clientY;
    startValue.current = value;
    setIsDragging(true);
  };

  const display = (v: number) => {
    if (v >= 1000) return `${Math.round(v / 100) / 10}k`;
    return `${Math.round(v)}`;
  };

  // Hold-to-repeat refs
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef(value);

  // Keep valueRef in sync with value prop
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const stopRepeat = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  const startRepeat = (direction: 1 | -1) => {
    // Immediately apply once
    let newVal = valueRef.current + direction * step;
    newVal = Math.max(min, Math.min(max, Math.round(newVal / step) * step));
    onChange(newVal);

    // After initial delay, start repeating
    timeoutRef.current = setTimeout(() => {
      intervalRef.current = setInterval(() => {
        let next = valueRef.current + direction * step;
        next = Math.max(min, Math.min(max, Math.round(next / step) * step));
        onChange(next);
      }, 80);
    }, 300);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => stopRepeat();
  }, []);

  return (
    <div className={`flex flex-col items-center ${className || ''}`}>
      {label && <label className="text-xs text-gray-400 uppercase tracking-wider">{label}</label>}
      <div className="flex items-center gap-1">
        {/* Minus button */}
        <button
          onMouseDown={() => startRepeat(-1)}
          onMouseUp={stopRepeat}
          onMouseLeave={stopRepeat}
          className="w-6 h-8 flex items-center justify-center bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded text-gray-400 hover:text-white text-lg font-bold select-none"
          aria-label={label ? `Decrease ${label}` : 'Decrease'}
          title={label ? `Decrease ${label}` : 'Decrease'}
        >
          −
        </button>
        <div
          className="bg-gray-800 rounded-md border border-gray-700 px-2 py-1 text-2xl font-orbitron text-yellow-400 cursor-ns-resize select-none min-w-[60px] text-center focus:outline-none focus:ring-2 focus:ring-yellow-400"
          onMouseDown={handleMouseDown}
          onWheel={handleWheel}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
              e.preventDefault();
              let newVal = value + step;
              newVal = Math.max(min, Math.min(max, Math.round(newVal / step) * step));
              onChange(newVal);
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
              e.preventDefault();
              let newVal = value - step;
              newVal = Math.max(min, Math.min(max, Math.round(newVal / step) * step));
              onChange(newVal);
            }
          }}
          role="slider"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-label={label}
        >
          {display(value)}
        </div>
        {/* Plus button */}
        <button
          onMouseDown={() => startRepeat(1)}
          onMouseUp={stopRepeat}
          onMouseLeave={stopRepeat}
          className="w-6 h-8 flex items-center justify-center bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded text-gray-400 hover:text-white text-lg font-bold select-none"
          aria-label={label ? `Increase ${label}` : 'Increase'}
          title={label ? `Increase ${label}` : 'Increase'}
        >
          +
        </button>
      </div>
    </div>
  );
};

export default DragValue;
