import React, { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import bezelImg from './assets/knob-bezel.png';
import { KnobGPUContext } from './KnobGPUContext';
import type { KnobMaterial } from './knobMaterial';
import {
    KNOB_MATERIAL,
    resolveTickPositions,
    resolveDetentPositions,
    isMajorTickPosition,
    wgslAngleFromNormalized,
    wgslAngleToCanvas,
    formatScaleLabel,
    rgbToHex,
} from './knobMaterial';
import { getKnobCanvasValue } from './knobInteraction';
import { KnobAutomationRing, KnobAutomationValue } from './KnobAutomationChrome';
import { KnobDragHud } from './KnobDragHud';
import { formatDragValue, formatKnobValue, formatNormalizedPercent } from './knobValueFormat';
import { knobValueToNormalized, renderKnob2D } from './knobRender';
import { useKnobInteraction } from '../hooks/useKnobInteraction';

export type HardwareKnobMode = 'classic' | 'holographic' | 'vertical' | 'horizontal' | 'numeric';
export type HardwareKnobColor = 'cyan' | 'pink' | 'yellow' | 'purple' | 'red' | 'green' | 'indigo';

export interface HardwareKnobProps {
    mode?: HardwareKnobMode;
    label: string;
    value: number;
    onChange: (value: number) => void;
    min: number;
    max: number;
    step?: number;
    color?: HardwareKnobColor;
    colorHex?: [number, number, number];
    unit?: string;
    logarithmic?: boolean;
    defaultValue?: number;
    isAutomated?: boolean;
    automatedValue?: number;
    /** Horizontal mode: pre-formatted readout string */
    valueLabel?: string;
    /** Holographic mode: pixel size of the knob face */
    size?: number;
    /** Holographic mode: show physical bezel image under the canvas */
    bezel?: boolean;
    className?: string;
    testId?: string;
    /** Numeric mode: show +/- stepper buttons */
    showSteppers?: boolean;
    /** Opt-in magnetic detent snap at material detent positions. */
    detentSnap?: boolean;
    /** Haptic/audio tick when crossing a detent (requires detentSnap). */
    detentFeedback?: boolean | 'audio' | 'haptic' | 'both';
    /** Use lit hardware pointer styling (defaults true for holographic/classic). */
    hardwarePointer?: boolean;
    /** Override default KNOB_MATERIAL for canvas renderers. */
    material?: KnobMaterial;
}

const CLASSIC_BODY_PX = 64;

const COLOR_CLASSES: Record<HardwareKnobColor, string> = {
    cyan: 'bg-cyan-500',
    pink: 'bg-pink-500',
    yellow: 'bg-yellow-500',
    purple: 'bg-purple-500',
    red: 'bg-red-500',
    green: 'bg-green-500',
    indigo: 'bg-indigo-500',
};

const FOCUS_BORDER_CLASSES: Record<HardwareKnobColor, string> = {
    cyan: 'focus-visible:border-cyan-400 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-cyan-400',
    pink: 'focus-visible:border-pink-400 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-pink-400',
    yellow: 'focus-visible:border-yellow-400 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-yellow-400',
    purple: 'focus-visible:border-purple-400 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-purple-400',
    red: 'focus-visible:border-red-400 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-red-400',
    green: 'focus-visible:border-green-400 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-green-400',
    indigo: 'focus-visible:border-indigo-400 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-indigo-400',
};

function valueToRotation(val: number, min: number, max: number, logarithmic: boolean): number {
    let percentage: number;
    if (logarithmic) {
        const logMin = Math.log(min || 0.001);
        const logMax = Math.log(max);
        const logVal = Math.log(val || 0.001);
        percentage = (logVal - logMin) / (logMax - logMin);
    } else {
        percentage = (val - min) / (max - min);
    }
    return -135 + percentage * 270;
}

function rgbaFromHex(colorHex: [number, number, number], alpha = 1): string {
    return `rgba(${colorHex[0] * 255}, ${colorHex[1] * 255}, ${colorHex[2] * 255}, ${alpha})`;
}

export const HardwareKnob: React.FC<HardwareKnobProps> = memo(({
    mode = 'classic',
    label,
    value,
    onChange,
    min,
    max,
    step = 1,
    color = 'cyan',
    colorHex,
    unit = '',
    logarithmic = false,
    defaultValue,
    isAutomated = false,
    automatedValue,
    valueLabel,
    size = 100,
    bezel = false,
    className = '',
    testId,
    showSteppers = true,
    detentSnap = false,
    detentFeedback = false,
    hardwarePointer,
    material = KNOB_MATERIAL,
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const gpuHandleRef = useRef<ReturnType<typeof KnobGPUContext.register>>(null);
    const renderValueRef = useRef(0);
    const isHolographic = mode === 'holographic';
    const isRotary = mode === 'classic' || isHolographic;
    const axis = mode === 'horizontal' ? 'horizontal' : 'vertical';

    const formatReadout = useCallback(
        (v: number) => {
            if (mode === 'horizontal' && valueLabel !== undefined) return valueLabel;
            if (mode === 'vertical') return formatNormalizedPercent((v - min) / (max - min));
            if (mode === 'numeric') return formatDragValue(v);
            return formatKnobValue(v, unit);
        },
        [valueLabel, max, min, mode, unit]
    );

    const repaintCanvas2D = useCallback((liveValue: number) => {
        const canvas = canvasRef.current;
        if (!canvas || (gpuHandleRef.current && KnobGPUContext.isSlotActive(gpuHandleRef.current))) return;
        const normalized = knobValueToNormalized(liveValue, min, max);
        renderKnob2D(canvas, getKnobCanvasValue({ value: normalized, isAutomated, automatedValue }), material);
    }, [automatedValue, isAutomated, max, min, material]);

    const handleActiveChange = useCallback((active: boolean) => {
        const handle = gpuHandleRef.current;
        if (!handle) return;
        KnobGPUContext.setAnimated(handle, active);
    }, []);

    const handleDragValue = useCallback((liveValue: number) => {
        const normalized = knobValueToNormalized(liveValue, min, max);
        renderValueRef.current = getKnobCanvasValue({
            value: normalized,
            isAutomated,
            automatedValue,
        });
        const handle = gpuHandleRef.current;
        if (handle && KnobGPUContext.isSlotActive(handle)) {
            KnobGPUContext.markDirty(handle);
            KnobGPUContext.renderImmediate(handle);
        } else {
            repaintCanvas2D(liveValue);
        }
    }, [automatedValue, isAutomated, max, min, repaintCanvas2D]);

    const {
        isDragging,
        dragModifier,
        displayValue,
        interactionProps,
    } = useKnobInteraction({
        value,
        min,
        max,
        step,
        logarithmic,
        onChange,
        defaultValue,
        label,
        axis,
        arcClick: isRotary,
        isAutomated,
        automatedValue,
        formatValue: formatReadout,
        onDragValue: isHolographic ? handleDragValue : undefined,
        onActiveChange: isHolographic ? handleActiveChange : undefined,
        detentSnap,
        material,
        detentFeedback,
    });

    const canvasRenderValue = getKnobCanvasValue({
        value: knobValueToNormalized(displayValue, min, max),
        isAutomated,
        automatedValue,
    });
    renderValueRef.current = canvasRenderValue;

    // Register once per holographic mount; value flows via renderValueRef + markDirty.
    useEffect(() => {
        if (!isHolographic) return;
        const canvas = canvasRef.current;
        if (!canvas) return;

        const handle = KnobGPUContext.register(canvas, () => renderValueRef.current);
        gpuHandleRef.current = handle;
        if (!handle || !KnobGPUContext.isSlotActive(handle)) {
            renderKnob2D(canvas, renderValueRef.current, material);
        } else {
            KnobGPUContext.markDirty(handle);
        }
        return () => {
            KnobGPUContext.unregister(handle);
            gpuHandleRef.current = null;
        };
    }, [isHolographic, material]);

    useEffect(() => {
        if (!isHolographic) return;
        return KnobGPUContext.onStatusChange(() => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            const h = gpuHandleRef.current;
            if (!h || !KnobGPUContext.isSlotActive(h)) {
                renderKnob2D(canvas, renderValueRef.current, material);
            }
        });
    }, [isHolographic, material]);

    // Value / palette / automation changes: mark dirty (static idle path re-renders once).
    useEffect(() => {
        if (!isHolographic) return;
        const handle = gpuHandleRef.current;
        if (handle && KnobGPUContext.isSlotActive(handle)) {
            KnobGPUContext.markDirty(handle);
            return;
        }
        const canvas = canvasRef.current;
        if (canvas) renderKnob2D(canvas, canvasRenderValue, material);
    }, [canvasRenderValue, isHolographic, material]);

    const bodyRadius = CLASSIC_BODY_PX / 2;
    const scaleTicks = useMemo(() => {
        if (mode !== 'classic') return [];
        const tickRadius = bodyRadius * KNOB_MATERIAL.geometry.arcRadius;
        const minorLen = bodyRadius * (KNOB_MATERIAL.scale?.tickLength ?? 0.06);
        const majorLen = bodyRadius * (KNOB_MATERIAL.scale?.majorTickLength ?? 0.09);
        return resolveTickPositions(KNOB_MATERIAL).map((t) => {
            const canvasAngle = wgslAngleToCanvas(wgslAngleFromNormalized(t, KNOB_MATERIAL.geometry));
            const isMajor = isMajorTickPosition(t, KNOB_MATERIAL);
            const halfLen = isMajor ? majorLen : minorLen;
            const cx = bodyRadius;
            const cy = bodyRadius;
            return {
                t,
                isMajor,
                label: formatScaleLabel(t),
                x1: cx + Math.cos(canvasAngle) * (tickRadius - halfLen),
                y1: cy + Math.sin(canvasAngle) * (tickRadius - halfLen),
                x2: cx + Math.cos(canvasAngle) * (tickRadius + halfLen),
                y2: cy + Math.sin(canvasAngle) * (tickRadius + halfLen),
                lx: cx + Math.cos(canvasAngle) * (tickRadius + majorLen + 4),
                ly: cy + Math.sin(canvasAngle) * (tickRadius + majorLen + 4),
            };
        });
    }, [bodyRadius, mode]);

    const accent = colorHex ? rgbaFromHex(colorHex) : undefined;
    const verticalNorm = (displayValue - min) / (max - min);
    const verticalHeight = 40;
    const horizontalPercent = ((displayValue - min) / (max - min)) * 100;

    if (mode === 'numeric') {
        return (
            <NumericKnob
                label={label}
                value={displayValue}
                onChange={onChange}
                min={min}
                max={max}
                step={step}
                defaultValue={defaultValue}
                className={className}
                showSteppers={showSteppers}
                interactionProps={interactionProps}
            />
        );
    }

    if (mode === 'horizontal') {
        const trackColor = isAutomated ? '#00e5ff' : (accent ?? '#22d3ee');
        return (
            <div className={`flex flex-col gap-1.5 w-full ${className}`}>
                <div className="flex justify-between items-center">
                    <span className="text-[9px] font-mono text-gray-400 uppercase tracking-wider">{label}</span>
                    {isAutomated ? (
                        <span
                            className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-zinc-950/50 border border-cyan-500/40 animate-pulse"
                            style={{ color: '#00e5ff', textShadow: '0 0 6px #00e5ff' }}
                        >
                            {formatReadout(displayValue)}
                        </span>
                    ) : (
                        <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-zinc-950/50 border border-zinc-800" style={{ color: trackColor, textShadow: `0 0 8px ${trackColor}60` }}>
                            {valueLabel ?? formatReadout(displayValue)}
                        </span>
                    )}
                </div>
                <div className="relative">
                    <KnobDragHud modifier={isDragging ? dragModifier : null} className="-top-3" />
                    <div
                        {...interactionProps}
                        className={`h-5 bg-zinc-900 rounded-md border cursor-ew-resize relative overflow-hidden shadow-[inset_0_2px_4px_rgba(0,0,0,0.5),inset_0_-1px_0_rgba(255,255,255,0.03)] focus:outline-none focus:ring-2 focus:ring-purple-400 ${
                            isAutomated
                                ? 'border-cyan-500/70 shadow-[inset_0_2px_4px_rgba(0,0,0,0.5),0_0_6px_rgba(0,229,255,0.3)]'
                                : 'border-zinc-700'
                        }`}
                    >
                        <div className="absolute inset-0 bg-gradient-to-b from-zinc-800/30 to-transparent" />
                        <div className="absolute left-1/2 top-0.5 bottom-0.5 w-px bg-gradient-to-b from-transparent via-white/30 to-transparent z-10" />
                        <div
                            className="absolute top-0.5 bottom-0.5 rounded-sm transition-all"
                            style={{
                                left: displayValue < 0 ? `${horizontalPercent}%` : '50%',
                                right: displayValue > 0 ? `${100 - horizontalPercent}%` : '50%',
                                background: `linear-gradient(to ${displayValue < 0 ? 'left' : 'right'}, ${isAutomated ? '#00e5ff40' : `${trackColor}40`} 0%, ${isAutomated ? '#00e5ff' : trackColor} 100%)`,
                                boxShadow: isAutomated
                                    ? '0 0 12px #00e5ff50, inset 0 1px 0 rgba(255,255,255,0.1)'
                                    : `0 0 12px ${trackColor}50, inset 0 1px 0 rgba(255,255,255,0.1)`,
                            }}
                        />
                        <div
                            className="absolute top-0.5 bottom-0.5 w-3 rounded-sm shadow-lg z-20 border border-white/20"
                            style={{
                                left: `calc(${horizontalPercent}% - 6px)`,
                                background: 'linear-gradient(180deg, #3a3a3a 0%, #1a1a1a 50%, #0a0a0a 100%)',
                                boxShadow: '0 2px 6px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.15)',
                            }}
                        >
                            <div className="absolute top-0.5 left-0.5 right-0.5 h-px bg-white/30 rounded-full" />
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (mode === 'vertical') {
        const fillColor = isAutomated ? '#00e5ff' : (accent ?? '#22d3ee');
        return (
            <div className={`flex flex-col items-center gap-1 ${className}`}>
                <span className="text-[9px] font-mono text-gray-400 uppercase tracking-wider">{label}</span>
                <div className="relative">
                    <KnobDragHud modifier={isDragging ? dragModifier : null} className="-top-3" />
                    {isAutomated && <KnobAutomationRing className="inset-0" />}
                    <div
                        {...interactionProps}
                        className={`w-6 rounded-full bg-zinc-900 cursor-ns-resize relative overflow-hidden focus:outline-none focus:ring-2 focus:ring-purple-400 ${
                            isAutomated
                                ? 'border-2 border-cyan-500/70 shadow-[inset_0_2px_4px_rgba(0,0,0,0.5),0_0_8px_rgba(0,229,255,0.4)]'
                                : 'border-2 border-zinc-600 shadow-[inset_0_2px_4px_rgba(0,0,0,0.5),inset_0_-1px_0_rgba(255,255,255,0.05)]'
                        }`}
                        style={{ height: `${verticalHeight}px` }}
                    >
                        <div className="absolute inset-0 rounded-full border border-white/5 pointer-events-none" />
                        <div
                            className="absolute bottom-0 left-0 right-0 rounded-b-full transition-all"
                            style={{
                                height: `${verticalNorm * verticalHeight}px`,
                                background: isAutomated
                                    ? 'linear-gradient(to top, #00e5ff, #00e5ff60 50%, #00e5ff30)'
                                    : `linear-gradient(to top, ${fillColor}, ${fillColor}60 50%, ${fillColor}30)`,
                                boxShadow: isAutomated
                                    ? '0 0 15px #00e5ff50, inset 0 -2px 4px rgba(0,0,0,0.3)'
                                    : `0 0 15px ${fillColor}50, inset 0 -2px 4px rgba(0,0,0,0.3)`,
                            }}
                        />
                        <div className="absolute left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent top-1/2" />
                        {[0.25, 0.5, 0.75].map((tick) => (
                            <div key={tick} className="absolute left-1 right-1 h-px bg-zinc-700" style={{ bottom: `${tick * 100}%` }} />
                        ))}
                    </div>
                </div>
                {isAutomated ? (
                    <KnobAutomationValue className="text-[8px] font-mono animate-pulse">
                        {formatReadout(displayValue)}
                    </KnobAutomationValue>
                ) : (
                    <span className="text-[8px] font-mono text-cyan-400/60">{formatReadout(displayValue)}</span>
                )}
            </div>
        );
    }

    if (mode === 'holographic') {
        return (
            <div className={`flex flex-col items-center select-none ${className}`} title={label}>
                <div className="relative" style={{ width: size, height: size }}>
                    <KnobDragHud modifier={isDragging ? dragModifier : null} className="top-0" />
                    {isAutomated && <KnobAutomationRing className="inset-0" style={{ zIndex: 5 }} />}
                    {bezel && (
                        <img
                            src={bezelImg}
                            alt=""
                            aria-hidden
                            style={{
                                width: '100%',
                                height: '100%',
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                zIndex: 0,
                                pointerEvents: 'none',
                                opacity: 0.8,
                            }}
                        />
                    )}
                    <div
                        {...interactionProps}
                        className="absolute inset-0 cursor-pointer focus:outline-none"
                        style={{ zIndex: 20 }}
                    />
                    <canvas
                        ref={canvasRef}
                        data-testid={testId}
                        style={{
                            width: '100%',
                            height: '100%',
                            borderRadius: '50%',
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            zIndex: 10,
                            pointerEvents: 'none',
                            transform: 'none',
                        }}
                    />
                </div>
                <span className="text-xs font-orbitron text-cyan-400 mt-1 drop-shadow-[0_0_5px_rgba(34,211,238,0.8)]">
                    {label}
                </span>
                {isAutomated && (
                    <KnobAutomationValue className="text-[9px] font-mono" showAutoBadge>
                        {formatReadout(displayValue)}
                    </KnobAutomationValue>
                )}
            </div>
        );
    }

    const useHardwarePointer = hardwarePointer ?? (mode === 'classic' || isHolographic);
    const rotation = valueToRotation(displayValue, min, max, logarithmic);
    const pointerBase = material.pointer?.base ?? material.palette.needle;
    const pointerSpec = material.pointer?.specular ?? material.palette.needle;
    const pointerShadow = material.pointer?.shadow ?? { r: 0.05, g: 0.08, b: 0.12 };
    const detentMarks = useMemo(() => {
        if (!material.detents) return [];
        return resolveDetentPositions(material).map((t) => {
            const canvasAngle = wgslAngleToCanvas(wgslAngleFromNormalized(t, material.geometry));
            const tickRadius = bodyRadius * (material.scale?.tickRadius ?? material.geometry.arcRadius);
            const dimpleDepth = bodyRadius * (material.detents?.dimpleDepth ?? 0.045);
            const innerR = tickRadius - dimpleDepth;
            const outerR = tickRadius + dimpleDepth * 0.65;
            const cx = bodyRadius;
            const cy = bodyRadius;
            return {
                t,
                x1: cx + Math.cos(canvasAngle) * innerR,
                y1: cy + Math.sin(canvasAngle) * innerR,
                x2: cx + Math.cos(canvasAngle) * outerR,
                y2: cy + Math.sin(canvasAngle) * outerR,
                mx: cx + Math.cos(canvasAngle) * tickRadius,
                my: cy + Math.sin(canvasAngle) * tickRadius,
            };
        });
    }, [bodyRadius, material]);
    return (
        <div className={`flex flex-col items-center space-y-1 ${className}`}>
            <div className="relative">
                <KnobDragHud modifier={isDragging ? dragModifier : null} />
                {isAutomated && <KnobAutomationRing className="inset-0" style={{ zIndex: 1 }} />}
                <div
                    {...interactionProps}
                    className={`w-16 h-16 bg-gray-700 rounded-full flex items-center justify-center cursor-pointer select-none border-2 border-gray-600 focus:outline-none ${FOCUS_BORDER_CLASSES[color]}`}
                    title={label}
                    data-testid={testId}
                >
                    <svg
                        className="absolute inset-0 pointer-events-none"
                        width={CLASSIC_BODY_PX}
                        height={CLASSIC_BODY_PX}
                        viewBox={`0 0 ${CLASSIC_BODY_PX} ${CLASSIC_BODY_PX}`}
                        aria-hidden="true"
                    >
                        <defs>
                            <linearGradient id="classic-needle-gradient" x1="0%" y1="100%" x2="0%" y2="0%">
                                <stop offset="0%" stopColor={rgbToHex(pointerShadow)} />
                                <stop offset="55%" stopColor={rgbToHex(pointerBase)} />
                                <stop offset="100%" stopColor={rgbToHex(pointerSpec)} />
                            </linearGradient>
                        </defs>
                        {scaleTicks.map((tick) => (
                            <g key={tick.t}>
                                <line
                                    x1={tick.x1}
                                    y1={tick.y1}
                                    x2={tick.x2}
                                    y2={tick.y2}
                                    stroke={tick.isMajor ? '#33ffff' : '#00bfd9'}
                                    strokeWidth={tick.isMajor ? 2 : 1}
                                    strokeLinecap="round"
                                />
                                {KNOB_MATERIAL.scale?.showLabels && tick.isMajor && (
                                    <text
                                        x={tick.lx}
                                        y={tick.ly}
                                        fill="#80e5ff"
                                        fontSize="7"
                                        fontFamily="monospace"
                                        fontWeight="bold"
                                        textAnchor="middle"
                                        dominantBaseline="middle"
                                    >
                                        {tick.label}
                                    </text>
                                )}
                            </g>
                        ))}
                        {detentMarks.map((d) => (
                            <g key={`detent-${d.t}`}>
                                <line
                                    x1={d.x1}
                                    y1={d.y1}
                                    x2={d.x2}
                                    y2={d.y2}
                                    stroke={rgbToHex(material.palette.detentShadow ?? { r: 0, g: 0.15, b: 0.2 })}
                                    strokeWidth={3}
                                    strokeLinecap="round"
                                />
                                <circle
                                    cx={d.mx}
                                    cy={d.my}
                                    r={bodyRadius * (material.detents?.dimpleDepth ?? 0.045) * 0.35}
                                    fill={rgbToHex(material.palette.detentShadow ?? { r: 0, g: 0.15, b: 0.2 })}
                                />
                            </g>
                        ))}
                    </svg>
                    <div
                        className="w-12 h-12 bg-gray-800 rounded-full relative shadow-inner"
                        data-testid="knob-needle"
                        style={{ transform: `rotate(${rotation}deg)`, transition: 'none' }}
                    >
                        {useHardwarePointer ? (
                            <>
                                <div
                                    className="absolute inset-0 rounded-full pointer-events-none"
                                    style={{
                                        background: `radial-gradient(ellipse at 35% 80%, ${rgbToHex(pointerShadow)} 0%, transparent 55%)`,
                                    }}
                                />
                                <div
                                    className="absolute top-1 left-1/2 -translate-x-1/2 w-1.5 h-3.5 rounded-full pointer-events-none"
                                    style={{
                                        background: 'linear-gradient(to top, var(--needle-shadow), var(--needle-spec))',
                                        ['--needle-shadow' as string]: rgbToHex(pointerShadow),
                                        ['--needle-spec' as string]: rgbToHex(pointerSpec),
                                        boxShadow: `0 0 4px ${rgbToHex(pointerSpec)}80`,
                                    }}
                                />
                            </>
                        ) : (
                            <div className={`absolute top-1 left-1/2 -translate-x-1/2 w-1 h-3 rounded-full ${COLOR_CLASSES[color]}`} />
                        )}
                    </div>
                </div>
            </div>
            <span className="text-xs text-gray-400 uppercase tracking-wider">{label}</span>
            {isAutomated ? (
                <KnobAutomationValue className="text-sm font-mono animate-pulse">
                    {formatReadout(displayValue)}
                </KnobAutomationValue>
            ) : (
                <span className="text-sm font-mono text-gray-300">{formatReadout(displayValue)}</span>
            )}
        </div>
    );
});

interface NumericKnobProps {
    label?: string;
    value: number;
    onChange: (value: number) => void;
    min: number;
    max: number;
    step: number;
    defaultValue?: number;
    className?: string;
    showSteppers: boolean;
    interactionProps: ReturnType<typeof useKnobInteraction>['interactionProps'];
}

const NumericKnob: React.FC<NumericKnobProps> = memo(({
    label,
    value,
    onChange,
    min,
    max,
    step,
    defaultValue,
    className,
    showSteppers,
    interactionProps,
}) => {
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const valueRef = useRef(value);
    valueRef.current = value;

    const stopRepeat = () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        intervalRef.current = null;
        timeoutRef.current = null;
    };

    const applyStep = (direction: 1 | -1) => {
        let next = valueRef.current + direction * step;
        next = Math.max(min, Math.min(max, Math.round(next / step) * step));
        onChange(next);
    };

    const startRepeat = (direction: 1 | -1) => {
        applyStep(direction);
        timeoutRef.current = setTimeout(() => {
            intervalRef.current = setInterval(() => applyStep(direction), 80);
        }, 300);
    };

    useEffect(() => () => stopRepeat(), []);

    return (
        <div className={`flex flex-col items-center ${className || ''}`}>
            {label && <label className="text-xs text-gray-400 uppercase tracking-wider">{label}</label>}
            <div className="flex items-center gap-1">
                {showSteppers && (
                    <button
                        type="button"
                        onClick={(e) => { if (e.detail === 0) applyStep(-1); }}
                        onMouseDown={() => startRepeat(-1)}
                        onMouseUp={stopRepeat}
                        onMouseLeave={stopRepeat}
                        className="w-6 h-8 flex items-center justify-center bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded text-gray-400 hover:text-white text-lg font-bold select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
                        aria-label={label ? `Decrease ${label}` : 'Decrease'}
                    >
                        −
                    </button>
                )}
                <div
                    {...interactionProps}
                    className="group relative bg-gray-800 rounded-md border border-gray-700 px-2 py-1 text-2xl font-orbitron text-yellow-400 cursor-ns-resize select-none min-w-[60px] text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
                >
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-[2px] opacity-0 group-hover:opacity-100 transition-opacity text-[8px] text-yellow-500/50 pointer-events-none">▲</div>
                    <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-[2px] opacity-0 group-hover:opacity-100 transition-opacity text-[8px] text-yellow-500/50 pointer-events-none">▼</div>
                    {formatDragValue(value)}
                </div>
                {showSteppers && (
                    <button
                        type="button"
                        onClick={(e) => { if (e.detail === 0) applyStep(1); }}
                        onMouseDown={() => startRepeat(1)}
                        onMouseUp={stopRepeat}
                        onMouseLeave={stopRepeat}
                        className="w-6 h-8 flex items-center justify-center bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded text-gray-400 hover:text-white text-lg font-bold select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
                        aria-label={label ? `Increase ${label}` : 'Increase'}
                    >
                        +
                    </button>
                )}
            </div>
        </div>
    );
});

export default HardwareKnob;
