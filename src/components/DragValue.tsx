import React, { useEffect, useRef, useState } from 'react';

interface DragValueProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  className?: string;
  defaultValue?: number;
}

// ⚡ Bolt: Added React.memo to prevent unnecessary re-renders when parent state changes.
export const DragValue: React.FC<DragValueProps> = React.memo(({ value, onChange, min = 0, max = 100, step = 1, label, className, defaultValue }) => {
  const [isDragging, setIsDragging] = useState(false);
  const startY = useRef(0);
  const startValue = useRef(value);
  const sliderRef = useRef<HTMLDivElement>(null);

  // Use a ref to store the latest props to avoid redefining callbacks and re-attaching event listeners
  const propsRef = useRef({ onChange, min, max, step });
  useEffect(() => {
    propsRef.current = { onChange, min, max, step };
  }, [onChange, min, max, step]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const dy = startY.current - e.clientY;
      const { onChange: currentOnChange, min: currentMin, max: currentMax, step: currentStep } = propsRef.current;
      const range = Math.max(1, currentMax - currentMin);
      const sensitivity = range / 200; // 200px for full range
      let newVal = startValue.current + dy * sensitivity;
      if (currentStep > 0) newVal = Math.round(newVal / currentStep) * currentStep;
      newVal = Math.max(currentMin, Math.min(currentMax, newVal));
      currentOnChange(newVal);
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
  }, [isDragging]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const dir = e.deltaY > 0 ? -1 : 1;
    const { onChange: currentOnChange, min: currentMin, max: currentMax, step: currentStep } = propsRef.current;
    let newVal = value + dir * (currentStep || 1);
    newVal = Math.round(newVal / currentStep) * currentStep;
    newVal = Math.max(currentMin, Math.min(currentMax, newVal));
    currentOnChange(newVal);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    sliderRef.current?.focus();
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
    const { onChange: currentOnChange, min: currentMin, max: currentMax, step: currentStep } = propsRef.current;
    let newVal = valueRef.current + direction * currentStep;
    newVal = Math.max(currentMin, Math.min(currentMax, Math.round(newVal / currentStep) * currentStep));
    currentOnChange(newVal);

    // After initial delay, start repeating
    timeoutRef.current = setTimeout(() => {
      intervalRef.current = setInterval(() => {
        const { onChange: activeOnChange, min: activeMin, max: activeMax, step: activeStep } = propsRef.current;
        let next = valueRef.current + direction * activeStep;
        next = Math.max(activeMin, Math.min(activeMax, Math.round(next / activeStep) * activeStep));
        activeOnChange(next);
      }, 80);
    }, 300);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => stopRepeat();
  }, []);

  const handleButtonClick = (e: React.MouseEvent, direction: 1 | -1) => {
    // Only handle keyboard activation (Enter/Space) where detail is 0
    // Mouse clicks (detail > 0) are handled by onMouseDown for repeat behavior
    if (e.detail === 0) {
      const { onChange: currentOnChange, min: currentMin, max: currentMax, step: currentStep } = propsRef.current;
      let newVal = valueRef.current + direction * currentStep;
      newVal = Math.max(currentMin, Math.min(currentMax, Math.round(newVal / currentStep) * currentStep));
      currentOnChange(newVal);
    }
  };

  return (
    <div className={`flex flex-col items-center ${className || ''}`}>
      {label && <label className="text-xs text-gray-400 uppercase tracking-wider">{label}</label>}
      <div className="flex items-center gap-1">
        {/* Minus button */}
        <button
          onClick={(e) => handleButtonClick(e, -1)}
          onMouseDown={() => startRepeat(-1)}
          onMouseUp={stopRepeat}
          onMouseLeave={stopRepeat}
          className="w-6 h-8 flex items-center justify-center bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded text-gray-400 hover:text-white text-lg font-bold select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 focus-visible:ring-offset-1 focus-visible:ring-offset-gray-900"
          aria-label={label ? `Decrease ${label}` : 'Decrease'}
          title={label ? `Decrease ${label}` : 'Decrease'}
        >
          −
        </button>
        <div
          ref={sliderRef}
          className="group relative bg-gray-800 rounded-md border border-gray-700 px-2 py-1 text-2xl font-orbitron text-yellow-400 cursor-ns-resize select-none min-w-[60px] text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400"
          onMouseDown={handleMouseDown}
          onWheel={handleWheel}
          tabIndex={0}
          onKeyDown={(e) => {
            let newVal = value;
            let handled = false;
            const { onChange: currentOnChange, min: currentMin, max: currentMax, step: currentStepProp } = propsRef.current;

            // Modifier multipliers
            const isShift = e.shiftKey;
            const multiplier = isShift ? 10 : 1;
            const currentStep = currentStepProp * multiplier;

            if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
              newVal += currentStep;
              handled = true;
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
              newVal -= currentStep;
              handled = true;
            } else if (e.key === 'PageUp') {
              newVal += currentStepProp * 5;
              handled = true;
            } else if (e.key === 'PageDown') {
              newVal -= currentStepProp * 5;
              handled = true;
            } else if (e.key === 'Home') {
              newVal = currentMin;
              handled = true;
            } else if (e.key === 'End') {
              newVal = currentMax;
              handled = true;
            }

            if (handled) {
              e.preventDefault();
              // Apply stepping logic
              newVal = Math.round(newVal / currentStepProp) * currentStepProp;
              newVal = Math.max(currentMin, Math.min(currentMax, newVal));
              currentOnChange(newVal);
            }
          }}
          role="slider"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={label ? `${display(value)} ${label}` : display(value)}
          aria-label={label}
          title={label ? `Drag up/down to adjust ${label}` : 'Drag up/down to adjust'}
          onDoubleClick={() => {
            const { onChange: currentOnChange, min: currentMin } = propsRef.current;
            currentOnChange(defaultValue ?? currentMin);
          }}
        >
          <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-[2px] opacity-0 group-hover:opacity-100 transition-opacity text-[8px] text-yellow-500/50 pointer-events-none">▲</div>
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-[2px] opacity-0 group-hover:opacity-100 transition-opacity text-[8px] text-yellow-500/50 pointer-events-none">▼</div>
          {display(value)}
        </div>
        {/* Plus button */}
        <button
          onClick={(e) => handleButtonClick(e, 1)}
          onMouseDown={() => startRepeat(1)}
          onMouseUp={stopRepeat}
          onMouseLeave={stopRepeat}
          className="w-6 h-8 flex items-center justify-center bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded text-gray-400 hover:text-white text-lg font-bold select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 focus-visible:ring-offset-1 focus-visible:ring-offset-gray-900"
          aria-label={label ? `Increase ${label}` : 'Increase'}
          title={label ? `Increase ${label}` : 'Increase'}
        >
          +
        </button>
      </div>
    </div>
  );
});

export default DragValue;
