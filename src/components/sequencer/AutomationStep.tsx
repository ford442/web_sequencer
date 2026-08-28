import { memo, useRef, useLayoutEffect } from 'react';
import type { TrackKey } from '../../types';
import { TRACK_COLORS } from './constants';

export const AutomationStep = memo(({
    stepIndex, value, rowKey, rowLabel, onChange, refsArray
}: {
    stepIndex: number, value: number, rowKey: TrackKey, rowLabel: string,
    onChange: (k: TrackKey, i: number, val: number) => void,
    refsArray: React.MutableRefObject<(SVGGElement | null)[]>
}) => {
    const cachedRectRef = useRef<DOMRect | null>(null);

    useLayoutEffect(() => {
        const el = refsArray.current[stepIndex];
        if (!el) return;

        cachedRectRef.current = el.getBoundingClientRect();

        const observer = new ResizeObserver(() => {
            cachedRectRef.current = el.getBoundingClientRect();
        });
        observer.observe(el);

        return () => observer.disconnect();
    }, [stepIndex, refsArray]);

    const baseWidth = 18;
    const gap = 4;
    const height = 50;
    const x = 220 + stepIndex * (baseWidth + gap);
    const color = TRACK_COLORS[rowKey] || '#22d3ee';

    // Calculate bar height based on value (0-1)
    const barHeight = Math.max(2, value * height);
    const y = height - barHeight;

    const handleKeyDown = (e: React.KeyboardEvent) => {
        let newValue = value;
        let handled = false;
        const smallStep = 0.05;
        const largeStep = 0.2;

        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
            newValue = Math.min(1, value + smallStep);
            handled = true;
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
            newValue = Math.max(0, value - smallStep);
            handled = true;
        } else if (e.key === 'PageUp') {
            newValue = Math.min(1, value + largeStep);
            handled = true;
        } else if (e.key === 'PageDown') {
            newValue = Math.max(0, value - largeStep);
            handled = true;
        } else if (e.key === 'Home') {
            newValue = 0;
            handled = true;
        } else if (e.key === 'End') {
            newValue = 1;
            handled = true;
        }

        if (handled) {
            e.preventDefault();
            e.stopPropagation();
            onChange(rowKey, stepIndex, newValue);
        }
    };

    const handlePointerDown = (e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const target = e.currentTarget as Element;
        target.setPointerCapture(e.pointerId);

        // We need bounding client rect to calculate relative Y
        const rect = cachedRectRef.current || target.getBoundingClientRect();

        const updateValue = (clientY: number) => {
            const relativeY = clientY - rect.top;
            // 0 is top, height is bottom
            // We want 1 at top (y=0), 0 at bottom (y=height)
            let val = 1 - (relativeY / rect.height);
            val = Math.max(0, Math.min(1, val));
            onChange(rowKey, stepIndex, val);
        };

        updateValue(e.clientY);

        const handlePointerMove = (ev: PointerEvent) => {
            updateValue(ev.clientY);
        };

        const handlePointerUp = (ev: PointerEvent) => {
            target.removeEventListener('pointermove', handlePointerMove as EventListener);
            target.removeEventListener('pointerup', handlePointerUp as EventListener);
            target.releasePointerCapture(ev.pointerId);
        };

        target.addEventListener('pointermove', handlePointerMove as EventListener);
        target.addEventListener('pointerup', handlePointerUp as EventListener);
    };


    return (
        <g
            transform={`translate(${x}, 0)`}
            ref={(el) => { refsArray.current[stepIndex] = el; }}
            className="automation-step"
            role="slider"
            aria-label={`${rowLabel} automation step ${stepIndex + 1}, ${value > 0 ? "Active" : "Inactive"}`}
            aria-valuenow={Math.round(value * 100)}
            aria-valuetext={`${Math.round(value * 100)}%`}
            tabIndex={0}
            cursor="ns-resize"
            onPointerDown={handlePointerDown}
            onKeyDown={handleKeyDown}
        >
            {/* Background container for click area */}
            <rect x={0} y={0} width={baseWidth} height={height} rx={2} fill="#111" fillOpacity={0.8} />

            {/* The Value Bar */}
            <rect
                x={1}
                y={y}
                width={baseWidth - 2}
                height={barHeight}
                rx={1}
                fill={color}
                fillOpacity={0.6}
                stroke={color}
                strokeWidth={1}
            />

            {/* Grid line at 50% */}
            <line x1={0} y1={height/2} x2={baseWidth} y2={height/2} stroke="#333" strokeDasharray="2,2" strokeWidth={1} pointerEvents="none" />
        </g>
    );
});
