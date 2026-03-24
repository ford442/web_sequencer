import React, { useCallback } from 'react';

export interface VerticalKnobProps {
    label: string;
    value: number; // 0-1
    onChange: (value: number) => void;
    colorHex: [number, number, number];
}

export const VerticalKnob: React.FC<VerticalKnobProps> = ({ label, value, onChange, colorHex }) => {
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        const startY = e.clientY;
        const startVal = value;

        const handleMouseMove = (e: MouseEvent) => {
            const dy = startY - e.clientY;
            const newVal = Math.max(0, Math.min(1, startVal + dy * 0.01));
            onChange(newVal);
        };

        const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = 'default';
        };

        document.body.style.cursor = 'ns-resize';
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }, [value, onChange]);

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
            newVal = 0;
            handled = true;
        } else if (e.key === 'End') {
            newVal = 1;
            handled = true;
        }

        if (handled) {
            e.preventDefault();
            onChange(Math.max(0, Math.min(1, newVal)));
        }
    }, [value, onChange]);

    const color = `rgba(${colorHex[0] * 255}, ${colorHex[1] * 255}, ${colorHex[2] * 255}, 1)`;
    const height = 40;
    const fillHeight = value * height;

    return (
        <div className="flex flex-col items-center gap-1">
            <span className="text-[9px] font-mono text-gray-400 uppercase tracking-wider">{label}</span>
            <div
                className="w-6 rounded-full bg-zinc-900 border-2 border-zinc-600 cursor-ns-resize relative overflow-hidden shadow-[inset_0_2px_4px_rgba(0,0,0,0.5),inset_0_-1px_0_rgba(255,255,255,0.05)] focus:outline-none focus:ring-2 focus:ring-purple-400"
                style={{ height: `${height}px` }}
                onMouseDown={handleMouseDown}
                onKeyDown={handleKeyDown}
                role="slider"
                tabIndex={0}
                aria-label={label}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(value * 100)}
                aria-valuetext={`${Math.round(value * 100)}%`}
                aria-orientation="vertical"
            >
                {/* Bevel highlight */}
                <div className="absolute inset-0 rounded-full border border-white/5 pointer-events-none" />
                {/* Fill with gradient */}
                <div
                    className="absolute bottom-0 left-0 right-0 rounded-b-full transition-all"
                    style={{
                        height: `${fillHeight}px`,
                        background: `linear-gradient(to top, ${color}, ${color}60 50%, ${color}30)`,
                        boxShadow: `0 0 15px ${color}50, inset 0 -2px 4px rgba(0,0,0,0.3)`
                    }}
                />
                {/* Center marker with LED style */}
                <div className="absolute left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent top-1/2" />
                {/* Tick marks */}
                {[0.25, 0.5, 0.75].map(tick => (
                    <div
                        key={tick}
                        className="absolute left-1 right-1 h-px bg-zinc-700"
                        style={{ bottom: `${tick * 100}%` }}
                    />
                ))}
            </div>
            <span className="text-[8px] font-mono text-cyan-400/60">{Math.round(value * 100)}%</span>
        </div>
    );
};
