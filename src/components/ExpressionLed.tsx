// ExpressionLed — circular canvas LED that pulses with audio level and note hue.
//
// Brightness: RMS from optional per-track AnalyserNode + decaying trigger envelope.
// Color: note color from the color-coded sequencer (falls back to track accent).

import React, { useRef, useEffect, memo } from 'react';
import { useLevelMeter, type LevelReading } from '../hooks/useLevelMeter';
import { expressionLedStore, type ExpressionLedTarget } from '../stores/expressionLedStore';

interface ExpressionLedProps {
    target: ExpressionLedTarget;
    analyserNode?: AnalyserNode | null;
    fallbackColor: string;
    size?: number;
    className?: string;
    'aria-label'?: string;
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

function drawExpressionLed(
    canvas: HTMLCanvasElement | null,
    color: string,
    brightness: number,
    size: number,
): void {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const px = Math.max(1, Math.floor(size * dpr));
    if (canvas.width !== px || canvas.height !== px) {
        canvas.width = px;
        canvas.height = px;
    }

    ctx.clearRect(0, 0, px, px);
    const cx = px / 2;
    const cy = px / 2;
    const radius = (px / 2) * 0.82;

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#1a2026';
    ctx.fill();

    if (brightness < 0.03) return;

    const glowRadius = radius * (0.65 + brightness * 0.55);
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius);
    gradient.addColorStop(0, color);
    gradient.addColorStop(0.45, color);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');

    ctx.globalAlpha = clamp01(0.25 + brightness * 0.85);
    ctx.beginPath();
    ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.globalAlpha = clamp01(0.4 + brightness * 0.6);
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.globalAlpha = 1;
}

function renderFrame(
    canvas: HTMLCanvasElement | null,
    target: ExpressionLedTarget,
    fallbackColor: string,
    size: number,
    level: number,
): void {
    expressionLedStore.tick();
    const channel = expressionLedStore.getChannel(target);
    const color = channel?.noteColor ?? fallbackColor;
    const envelope = channel?.envelope ?? 0;
    const brightness = clamp01(level * 2.2 + envelope * 0.75);
    drawExpressionLed(canvas, color, brightness, size);
}

export const ExpressionLed: React.FC<ExpressionLedProps> = memo(({
    target,
    analyserNode,
    fallbackColor,
    size = 10,
    className = '',
    'aria-label': ariaLabel,
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const drawFromReading = (reading: LevelReading) => {
        renderFrame(canvasRef.current, target, fallbackColor, size, reading.level);
    };

    useLevelMeter(analyserNode, { onFrame: drawFromReading });

    // Envelope-only fallback when no analyser is wired (drums, 303 voices).
    useEffect(() => {
        if (analyserNode) return;
        let raf = 0;
        const tick = () => {
            renderFrame(canvasRef.current, target, fallbackColor, size, 0);
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [analyserNode, target, fallbackColor, size]);

    useEffect(() => {
        drawExpressionLed(canvasRef.current, fallbackColor, 0, size);
    }, [fallbackColor, size]);

    return (
        <canvas
            ref={canvasRef}
            width={size}
            height={size}
            className={`inline-block shrink-0 rounded-full ${className}`}
            style={{ width: size, height: size }}
            role={ariaLabel ? 'img' : undefined}
            aria-label={ariaLabel}
            aria-hidden={ariaLabel ? undefined : true}
        />
    );
});

ExpressionLed.displayName = 'ExpressionLed';
