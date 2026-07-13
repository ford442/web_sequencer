// LevelMeter — compact Canvas 2D LED-strip audio level meter.
//
// Renders as a row of colored segments (green → yellow → red) with peak hold.
// Driven by useLevelMeter; draws on every animation frame without React re-renders.
//
// Usage:
//   <LevelMeter analyserNode={audioEngine?.analyserNode} />

import React, { useRef, useEffect, memo } from 'react';
import { useLevelMeter } from '../hooks/useLevelMeter';

interface LevelMeterProps {
    analyserNode?: AnalyserNode | null;
    /** Total number of LED segments. Default 12. */
    segments?: number;
    /** Width in pixels. Default 120. */
    width?: number;
    /** Height in pixels. Default 8. */
    height?: number;
    /** Tailwind / extra CSS classes. */
    className?: string;
    /** Segment at which color transitions from green → yellow (0-indexed). Default 8. */
    yellowThreshold?: number;
    /** Segment at which color transitions from yellow → red (0-indexed). Default 10. */
    redThreshold?: number;
}

// Segment colors. These are intentionally opaque constants so Tailwind's JIT
// scanner doesn't need to touch them.
const COLOR_OFF    = '#1a2026';
const COLOR_GREEN  = '#22c55e';
const COLOR_YELLOW = '#eab308';
const COLOR_RED    = '#ef4444';
const COLOR_PEAK   = '#ffffff';

export const LevelMeter: React.FC<LevelMeterProps> = memo(({
    analyserNode,
    segments = 12,
    width = 120,
    height = 8,
    className = '',
    yellowThreshold = 8,
    redThreshold = 10,
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const reading = useLevelMeter(analyserNode, {
        onFrame: () => {
            draw(
                canvasRef.current,
                reading.level,
                reading.peak,
                segments,
                yellowThreshold,
                redThreshold,
            );
        },
    });

    // Draw once on mount to show the idle state.
    useEffect(() => {
        draw(canvasRef.current, 0, 0, segments, yellowThreshold, redThreshold);
    }, [segments, yellowThreshold, redThreshold]);

    return (
        <canvas
            ref={canvasRef}
            width={width}
            height={height}
            className={className}
            aria-hidden="true"
            style={{ imageRendering: 'pixelated', display: 'block' }}
        />
    );
});

LevelMeter.displayName = 'LevelMeter';

// ── Drawing logic (pure, no React) ────────────────────────────────────────────

function draw(
    canvas: HTMLCanvasElement | null,
    level: number,
    peak: number,
    segments: number,
    yellowThreshold: number,
    redThreshold: number,
): void {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const gap = 2;
    const segW = Math.floor((w - gap * (segments - 1)) / segments);
    const litCount = Math.round(level * segments);
    const peakSeg = Math.min(segments - 1, Math.round(peak * segments));

    ctx.clearRect(0, 0, w, h);

    for (let i = 0; i < segments; i++) {
        const x = i * (segW + gap);
        const lit = i < litCount;
        const isPeak = i === peakSeg && peak > 0.05;

        let color: string;
        if (isPeak) {
            color = COLOR_PEAK;
        } else if (!lit) {
            color = COLOR_OFF;
        } else if (i >= redThreshold) {
            color = COLOR_RED;
        } else if (i >= yellowThreshold) {
            color = COLOR_YELLOW;
        } else {
            color = COLOR_GREEN;
        }

        ctx.fillStyle = color;
        ctx.fillRect(x, 0, segW, h);
    }
}
