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

  return (
    <div className={`flex flex-col items-center ${className || ''}`}>
      {label && <label className="text-xs text-gray-400 uppercase tracking-wider">{label}</label>}
      <div
        className="bg-gray-800 rounded-md border border-gray-700 px-2 py-1 text-2xl font-orbitron text-yellow-400 cursor-ns-resize select-none"
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
    </div>
  );
};

export default DragValue;
