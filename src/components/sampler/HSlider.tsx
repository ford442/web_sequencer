import React, { useCallback, useRef, useEffect } from 'react';

export interface HSliderProps {
    label: string;
    value: number; // -1 to 1 normalized
    displayValue: string;
    onChange: (value: number) => void;
    colorHex: [number, number, number];
}

// ⚡ Bolt: Added React.memo to prevent unnecessary re-renders when parent state changes.
export const HSlider: React.FC<HSliderProps> = React.memo(({ label, value, displayValue, onChange, colorHex }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const cachedRectRef = useRef<DOMRect | null>(null);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        cachedRectRef.current = container.getBoundingClientRect();

        const observer = new ResizeObserver(() => {
            cachedRectRef.current = container.getBoundingClientRect();
        });

        observer.observe(container);
        return () => observer.disconnect();
    }, []);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        const rect = cachedRectRef.current || containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const handleMouseMove = (e: MouseEvent) => {
            const x = e.clientX - rect.left;
            const normalized = Math.max(-1, Math.min(1, (x / rect.width) * 2 - 1));
            onChange(normalized);
        };

        const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = 'default';
        };

        document.body.style.cursor = 'ew-resize';
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        // Initial set
        const x = e.clientX - rect.left;
        const normalized = Math.max(-1, Math.min(1, (x / rect.width) * 2 - 1));
        onChange(normalized);
    }, [onChange]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        let newVal = value;
        let handled = false;
        const step = 0.05;

        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
            newVal += step;
            handled = true;
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
            newVal -= step;
            handled = true;
        } else if (e.key === 'PageUp') {
            newVal += step * 5;
            handled = true;
        } else if (e.key === 'PageDown') {
            newVal -= step * 5;
            handled = true;
        } else if (e.key === 'Home') {
            newVal = -1;
            handled = true;
        } else if (e.key === 'End') {
            newVal = 1;
            handled = true;
        }

        if (handled) {
            e.preventDefault();
            onChange(Math.max(-1, Math.min(1, newVal)));
        }
    }, [value, onChange]);

    const color = `rgba(${colorHex[0] * 255}, ${colorHex[1] * 255}, ${colorHex[2] * 255}, 1)`;
    const percent = ((value + 1) / 2) * 100;

    return (
        <div className="flex flex-col gap-1.5 w-full">
            <div className="flex justify-between items-center">
                <span className="text-[9px] font-mono text-gray-400 uppercase tracking-wider">{label}</span>
                <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-zinc-950/50 border border-zinc-800" style={{ color, textShadow: `0 0 8px ${color}60` }}>{displayValue}</span>
            </div>
            <div
                ref={containerRef}
                className="h-5 bg-zinc-900 rounded-md border border-zinc-700 cursor-ew-resize relative overflow-hidden shadow-[inset_0_2px_4px_rgba(0,0,0,0.5),inset_0_-1px_0_rgba(255,255,255,0.03)] focus:outline-none focus:ring-2 focus:ring-purple-400"
                onMouseDown={handleMouseDown}
                onKeyDown={handleKeyDown}
                role="slider"
                tabIndex={0}
                aria-label={label}
                aria-valuemin={-1}
                aria-valuemax={1}
                aria-valuenow={value}
                aria-valuetext={displayValue}
            >
                {/* Track background with gradient */}
                <div className="absolute inset-0 bg-gradient-to-b from-zinc-800/30 to-transparent" />
                {/* Center line with LED glow */}
                <div className="absolute left-1/2 top-0.5 bottom-0.5 w-px bg-gradient-to-b from-transparent via-white/30 to-transparent z-10" />
                {/* Fill from center with glow */}
                <div
                    className="absolute top-0.5 bottom-0.5 rounded-sm transition-all"
                    style={{
                        left: value < 0 ? `${percent}%` : '50%',
                        right: value > 0 ? `${100 - percent}%` : '50%',
                        background: `linear-gradient(to ${value < 0 ? 'left' : 'right'}, ${color}40 0%, ${color} 100%)`,
                        boxShadow: `0 0 12px ${color}50, inset 0 1px 0 rgba(255,255,255,0.1)`
                    }}
                />
                {/* Thumb with plastic look */}
                <div
                    className="absolute top-0.5 bottom-0.5 w-3 rounded-sm shadow-lg z-20 border border-white/20"
                    style={{
                        left: `calc(${percent}% - 6px)`,
                        background: `linear-gradient(180deg, #3a3a3a 0%, #1a1a1a 50%, #0a0a0a 100%)`,
                        boxShadow: `0 2px 6px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.15)`
                    }}
                >
                    {/* Thumb highlight */}
                    <div className="absolute top-0.5 left-0.5 right-0.5 h-px bg-white/30 rounded-full" />
                </div>
            </div>
        </div>
    );
});
