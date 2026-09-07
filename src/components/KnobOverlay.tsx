import { memo } from 'react';
import { MidiBadge } from './MidiBadge';
import { buildKnobAutomationSvgPath, knobIndicatorPosition } from './knobAutomationOverlay';
import type { KnobConfig } from './HardwareModule';

// PERFORMANCE: Memoized Knob Overlay Component
export interface KnobOverlayProps {
    id: string;
    label: string;
    x: number;
    y: number;
    size: number;
    value: number;
    valueDisplay?: string;
    isRecording?: boolean;
    isAutomated?: boolean;
    automatedValue?: number;
    isMidiMapped?: boolean;
    isMidiActive?: boolean;
    automationPreview?: KnobConfig['automationPreview'];
    automationDimmed?: boolean;
    showAutomationOverlay?: boolean;
    indicatorValue?: number;
    colorHex: [number, number, number];
    index: number;
    onParamChange: (id: string, value: number) => void;
    onRecordToggle?: (id: string) => void;
    onRegisterRef: (index: number, el: HTMLDivElement | null) => void;
    compact?: boolean;
}

export const KnobOverlay = memo(({
    id, label, x, y, size, value, valueDisplay, isRecording, isAutomated, automatedValue, isMidiMapped, isMidiActive,
    automationPreview, automationDimmed, showAutomationOverlay, indicatorValue,
    colorHex, index, onParamChange, onRecordToggle, onRegisterRef, compact = false
}: KnobOverlayProps) => {
    const viewSize = 100;
    const ghostPath = automationPreview?.curveSamples?.length
        ? buildKnobAutomationSvgPath(automationPreview.curveSamples, viewSize)
        : '';
    const indicatorPos = indicatorValue !== undefined
        ? knobIndicatorPosition(indicatorValue, viewSize)
        : null;

    return (
        <>
            {/* Automation ghost arc (GPU knob slots — 2D canvas draws its own overlay) */}
            {showAutomationOverlay && ghostPath && (
                <svg
                    className="absolute pointer-events-none"
                    viewBox={`0 0 ${viewSize} ${viewSize}`}
                    style={{
                        left: `${x * 100}%`,
                        top: `${y * 100}%`,
                        width: `${size * 200}%`,
                        height: `${size * 200}%`,
                        transform: 'translate(-50%, -50%)',
                        zIndex: 4,
                        opacity: automationDimmed ? 0.35 : 1,
                    }}
                    aria-hidden="true"
                >
                    <path d={ghostPath} fill="none" stroke="var(--hyphon-knob-ring-dim)" strokeWidth="1.5" strokeLinejoin="round" />
                    {indicatorPos && (
                        <circle cx={indicatorPos.x} cy={indicatorPos.y} r="3" fill="var(--hyphon-knob-ring)" opacity="0.9" />
                    )}
                </svg>
            )}

            {/* Automation ring — cyan pulsing glow when an automation lane is active */}
            {isAutomated && (
                <div
                    className="absolute rounded-full pointer-events-none animate-pulse"
                    style={{
                        left: `${x * 100}%`,
                        top: `${y * 100}%`,
                        width: `${size * 230}%`,
                        height: `${size * 230}%`,
                        transform: 'translate(-50%, -50%)',
                        border: '2px solid var(--hyphon-knob-ring)',
                        boxShadow: '0 0 8px var(--hyphon-knob-ring), 0 0 16px color-mix(in srgb, var(--hyphon-knob-ring) 40%, transparent)',
                        zIndex: 5,
                    }}
                    aria-hidden="true"
                />
            )}

            {/* 1. Label and Value Display */}
            <div
                className={`absolute text-center transform -translate-x-1/2 pointer-events-none transition-opacity duration-200 ${automationDimmed ? 'opacity-40' : ''}`}
                style={{
                    left: `${x * 100}%`,
                    top: `${(y + size * (compact ? 0.72 : 0.8)) * 100}%`,
                    color: `rgba(${colorHex[0] * 255},${colorHex[1] * 255},${colorHex[2] * 255},0.8)`,
                    zIndex: 10
                }}
            >
                <span className={`${compact ? 'text-[8px]' : 'text-[10px]'} font-mono font-bold tracking-wider drop-shadow-md truncate block`}>{label}</span>
                {/* When automated, show both the live automated value and an AUTO badge */}
                {isAutomated && automatedValue !== undefined ? (
                    <div className="text-[9px] font-mono leading-tight">
                        <span
                            className="text-[8px] font-bold uppercase tracking-widest px-0.5 rounded"
                            style={{ color: 'var(--hyphon-knob-ring)', textShadow: '0 0 6px var(--hyphon-knob-ring)' }}
                        >
                            AUTO
                        </span>
                        <div style={{ color: 'var(--hyphon-knob-ring)', textShadow: '0 0 4px color-mix(in srgb, var(--hyphon-knob-ring) 50%, transparent)' }}>
                            {Math.round(automatedValue * 100)}
                        </div>
                    </div>
                ) : (
                    <div className="text-[9px] opacity-60 font-mono">{valueDisplay ?? Math.round(value * 100)}</div>
                )}
            </div>

            {/* 2. Record + MIDI badges */}
            {(onRecordToggle || isMidiMapped || isMidiActive) && (
                <div
                    className="absolute pointer-events-none transform -translate-x-1/2 flex items-center gap-0.5"
                    style={{
                        left: `${x * 100}%`,
                        top: `${(y - size * 1.3) * 100}%`,
                        zIndex: 20,
                    }}
                >
                    {onRecordToggle && (
                        <button type="button"
                            onClick={(e) => { e.stopPropagation(); onRecordToggle(id); }}
                            className="pointer-events-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 rounded-full"
                            style={{ width: '16px', height: '16px' }}
                            title="Record Automation"
                            aria-label={`Record Automation for ${label}`}
                            aria-pressed={isRecording}
                        >
                            <div className={`w-full h-full rounded-full flex items-center justify-center text-[10px] font-bold ${isRecording ? 'bg-red-600 text-white animate-pulse' : 'bg-gray-800 text-red-500 border border-red-900/50 hover:bg-red-900/30'}`}>R</div>
                        </button>
                    )}
                    <MidiBadge mapped={isMidiMapped} active={isMidiActive} />
                </div>
            )}

            {/* 3. Accessibility Slider */}
            <div
                ref={(el) => onRegisterRef(index, el)}
                role="slider"
                aria-label={isAutomated ? `${label} (automated)` : label}
                aria-valuetext={isAutomated && automatedValue !== undefined
                    ? `${Math.round(automatedValue * 100)} (automated)`
                    : valueDisplay}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(value * 100)}
                aria-description={isAutomated ? 'This parameter is currently driven by an automation lane' : undefined}
                tabIndex={0}
                className="absolute transform -translate-x-1/2 -translate-y-1/2 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white pointer-events-none"
                style={{
                    left: `${x * 100}%`,
                    top: `${y * 100}%`,
                    width: `${size * 200}%`,
                    height: `${size * 200}%`,
                    zIndex: 30
                }}
                onKeyDown={(e) => {
                    let newVal = value;
                    let handled = false;
                    const isShift = e.shiftKey;
                    const isFine = e.altKey || e.ctrlKey || e.metaKey;
                    const step = isShift ? 0.2 : (isFine ? 0.005 : 0.05);

                    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
                        newVal += step;
                        handled = true;
                    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
                        newVal -= step;
                        handled = true;
                    } else if (e.key === 'PageUp') {
                        newVal += 0.1;
                        handled = true;
                    } else if (e.key === 'PageDown') {
                        newVal -= 0.1;
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
                        e.stopPropagation();
                        onParamChange(id, Math.max(0, Math.min(1, newVal)));
                    }
                }}
            />
        </>
    );
});
