import React, { memo, useRef, useEffect, useCallback, useState } from 'react';
import { KnobGPUContext, type SlotHandle } from './KnobGPUContext';
import { KNOB_MATERIAL, resolveDetentPositions } from './knobMaterial';
import { renderKnob2D } from './knobRender';
export type { Knob2DDimensions, Knob2DDrawCommand } from './knobRender';
export { buildKnob2DDrawCalls } from './knobRender';
import { isPointerNearArcRing, valueFromArcPointer, createKnobDragAnchor, computeKnobDragValue, getKnobCanvasValue, getKnobDragCursor, type KnobDragAnchor, type KnobDragModifier } from './knobInteraction';
import { notifyDetentCross, snappedDetentIndex } from './knobDetentFeedback';
import { findHitKnobIndex } from '../utils/touchHitTesting';
import { useCompactLayoutOptional } from '../contexts/CompactLayoutContext';
import { MidiBadge } from './MidiBadge';
import type { AutomationTarget } from '../types';
import { automationStore, useAutomationStore } from '../stores/automationStore';
import { smoothToward, getRecordingBufferValue } from '../utils/knobAutomationCurve';
import type { KnobAutomationOverlayState } from './knobAutomationOverlay';
import { buildKnobAutomationSvgPath, knobIndicatorPosition } from './knobAutomationOverlay';

const KNOB_TEST_ID_SANITIZE_PATTERN = /[^A-Za-z0-9_-]/g;

export interface KnobConfig {
    id: string;
    label: string;
    x: number;
    y: number;
    size: number;
    value: number;
    isRecording?: boolean;
    /** True when an enabled automation lane is actively driving this parameter. */
    isAutomated?: boolean;
    /** Current normalized (0–1) automated value when isAutomated is true. */
    automatedValue?: number;
    valueDisplay?: string;
    /** Opt-in magnetic detent snap at 0 / 50% / 100%. */
    enableDetentSnap?: boolean;
    /** Haptic/audio tick when crossing a detent. */
    detentFeedback?: boolean | 'audio' | 'haptic' | 'both';
    isMidiMapped?: boolean;
    isMidiActive?: boolean;
    /** Lane preview for arc ghost curve on the knob face. */
    automationPreview?: {
        laneId: string;
        curveSamples: number[];
        hasLane: boolean;
        laneEnabled: boolean;
    };
    /** Dim knob when global automation highlight is on but param has no lane. */
    automationDimmed?: boolean;
}

interface HardwareModuleProps {
    title: string;
    colorHex: [number, number, number];
    controls: KnobConfig[];
    onParamChange: (id: string, value: number) => void;
    onRecordToggle?: (id: string) => void;
    children?: React.ReactNode;
    /** Optional badge rendered in the title bar (e.g. engine indicator pill). */
    titleBadge?: React.ReactNode;
    is3D?: boolean; // Kept for API compatibility; no longer drives knob rendering
    /** Automation target for MIDI learn / map (e.g. synthA, kick). */
    midiTarget?: AutomationTarget;
    onMidiTouch?: (paramId: string) => void;
    onMidiLearnStart?: (paramId: string) => void;
    isMidiMapped?: (paramId: string) => boolean;
    isMidiActive?: (paramId: string) => boolean;
    automationTarget?: AutomationTarget;
    patternIndex?: number;
    onAutomationNudge?: (paramId: string, value: number, step: number) => void;
    onAutomationPunchIn?: (paramId: string) => void;
    onAutomationLaneAction?: (action: 'toggle' | 'clear', paramId?: string) => void;
}

// PERFORMANCE: Memoized Knob Overlay Component
interface KnobOverlayProps {
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

const KnobOverlay = memo(({
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
                    <path d={ghostPath} fill="none" stroke="rgba(0,229,255,0.4)" strokeWidth="1.5" strokeLinejoin="round" />
                    {indicatorPos && (
                        <circle cx={indicatorPos.x} cy={indicatorPos.y} r="3" fill="#00e5ff" opacity="0.9" />
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
                        border: '2px solid #00e5ff',
                        boxShadow: '0 0 8px #00e5ff, 0 0 16px #00e5ff60',
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
                            style={{ color: '#00e5ff', textShadow: '0 0 6px #00e5ff' }}
                        >
                            AUTO
                        </span>
                        <div style={{ color: '#00e5ff', textShadow: '0 0 4px #00e5ff80' }}>
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
                            className="pointer-events-auto"
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
                className="absolute transform -translate-x-1/2 -translate-y-1/2 rounded-full focus:ring-2 focus:ring-white focus:outline-none pointer-events-none"
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

export const HardwareModule = memo(
    ({
        title,
        colorHex,
        controls,
        onParamChange,
        onRecordToggle,
        children,
        titleBadge,
        is3D = false,
        onMidiTouch,
        onMidiLearnStart,
        isMidiMapped,
        isMidiActive,
        automationTarget,
        patternIndex = 0,
        onAutomationNudge,
        onAutomationPunchIn,
        onAutomationLaneAction,
    }: HardwareModuleProps) => {
        const compactLayout = useCompactLayoutOptional();
        const isCompact = compactLayout?.isCompact ?? false;
        const { showHardwareAutomation } = useAutomationStore();
        const [automationMenu, setAutomationMenu] = useState<{
            x: number; y: number; paramId?: string; scope: 'knob' | 'panel';
        } | null>(null);
        const containerRef = useRef<HTMLDivElement>(null);
        const cachedRectRef = useRef<DOMRect | null>(null);
        const controlsRef = useRef(controls);
        const prevControlsRef = useRef<KnobConfig[]>([]);
        const activeKnobIndex = useRef<number | null>(null);
        const dragAnchorRef = useRef<KnobDragAnchor | null>(null);
        const dragLiveValueRef = useRef(0);
        const dragHudRef = useRef<HTMLDivElement | null>(null);
        const lastDetentIndexRef = useRef<number | null>(null);
        const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
        const longPressKnobIdRef = useRef<string | null>(null);
        const smoothedRecordingRef = useRef<Record<string, number>>({});
        const dragNudgeRef = useRef(false);
        const automationTargetRef = useRef(automationTarget);
        automationTargetRef.current = automationTarget;

        const knobCanvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
        const knobHandlesRef = useRef<(SlotHandle | null)[]>([]);

        // Refs for accessibility elements
        const sliderRefs = useRef<(HTMLDivElement | null)[]>([]);

        const handleRegisterRef = useCallback((index: number, el: HTMLDivElement | null) => {
            sliderRefs.current[index] = el;
        }, []);

        const getRecordingValue = useCallback((ctrl: KnobConfig): number | undefined => {
            if (!ctrl.isRecording || !automationTargetRef.current) return undefined;
            const buf = automationStore.getState().recordingBuffers.find(
                (b) => b.target === automationTargetRef.current && b.parameter === ctrl.id && b.isRecording,
            );
            if (!buf) return undefined;
            const target = getRecordingBufferValue(buf.points);
            if (target === null) return undefined;
            const smoothed = smoothedRecordingRef.current[ctrl.id] ?? target;
            return smoothed;
        }, []);

        const getCanvasValueAt = useCallback((index: number): number => {
            const ctrl = controlsRef.current[index];
            if (!ctrl) return 0;
            const dragOverride = activeKnobIndex.current === index ? dragLiveValueRef.current : null;
            const recordingValue = getRecordingValue(ctrl);
            return getKnobCanvasValue({ ...ctrl, recordingValue }, dragOverride);
        }, [getRecordingValue]);

        const getAutomationOverlayAt = useCallback((index: number): KnobAutomationOverlayState | undefined => {
            const ctrl = controlsRef.current[index];
            if (!ctrl?.automationPreview?.hasLane) return undefined;
            const showMode = automationStore.getState().showHardwareAutomation;
            if (!showMode && !ctrl.isAutomated && !ctrl.isRecording) return undefined;
            const indicatorValue = getCanvasValueAt(index);
            return {
                showCurve: showMode && ctrl.automationPreview.curveSamples.length >= 2,
                curveSamples: ctrl.automationPreview.curveSamples,
                indicatorValue: (ctrl.isAutomated || ctrl.isRecording) ? indicatorValue : undefined,
            };
        }, [getCanvasValueAt]);

        const renderCanvasAt = useCallback((index: number) => {
            const canvas = knobCanvasRefs.current[index];
            if (!canvas || knobHandlesRef.current[index] !== null) return;
            renderKnob2D(canvas, getCanvasValueAt(index), KNOB_MATERIAL, getAutomationOverlayAt(index));
        }, [getCanvasValueAt, getAutomationOverlayAt]);

        // Sync controls ref and drive 2D fallback re-renders when values change
        useEffect(() => {
            controlsRef.current = controls;
            const prev = prevControlsRef.current;
            const handles = knobHandlesRef.current;
            controls.forEach((ctrl, i) => {
                if (handles[i] === null) {
                    const prevCtrl = prev[i];
                    if (prevCtrl && prevCtrl.id === ctrl.id) {
                        const prevRender = getKnobCanvasValue(
                            prevCtrl,
                            activeKnobIndex.current === i ? dragLiveValueRef.current : null
                        );
                        const nextRender = getKnobCanvasValue(
                            ctrl,
                            activeKnobIndex.current === i ? dragLiveValueRef.current : null
                        );
                        if (prevRender !== nextRender) {
                            renderCanvasAt(i);
                        }
                    }
                }
            });
            prevControlsRef.current = controls;
        }, [controls, renderCanvasAt]);

        // Smooth recording needle + playhead overlay refresh without React re-renders.
        useEffect(() => {
            let raf = 0;
            let lastStep = -1;
            const tick = () => {
                const state = automationStore.getState();
                let dirty = false;

                if (state.playbackStep !== lastStep) {
                    lastStep = state.playbackStep;
                    dirty = true;
                }

                controlsRef.current.forEach((ctrl) => {
                    if (!ctrl.isRecording || !automationTargetRef.current) return;
                    const buf = state.recordingBuffers.find(
                        (b) => b.target === automationTargetRef.current && b.parameter === ctrl.id && b.isRecording,
                    );
                    if (!buf || buf.points.length === 0) return;
                    const target = buf.points[buf.points.length - 1].value;
                    const prev = smoothedRecordingRef.current[ctrl.id] ?? target;
                    const next = smoothToward(prev, target);
                    if (Math.abs(next - prev) > 0.0005) {
                        smoothedRecordingRef.current[ctrl.id] = next;
                        dirty = true;
                    }
                });

                if (dirty) {
                    controlsRef.current.forEach((_, i) => {
                        if (knobHandlesRef.current[i] === null) renderCanvasAt(i);
                    });
                }
                raf = requestAnimationFrame(tick);
            };
            raf = requestAnimationFrame(tick);
            return () => cancelAnimationFrame(raf);
        }, [renderCanvasAt]);

        // --- INTERACTION LOGIC (Mouse + Touch + Wheel) ---
        useEffect(() => {
            const container = containerRef.current;
            if (!container) return;

            cachedRectRef.current = container.getBoundingClientRect();

            const observer = new ResizeObserver(() => {
                cachedRectRef.current = container.getBoundingClientRect();
            });
            observer.observe(container);

            const findHitKnob = (clientX: number, clientY: number): number => {
                const rect = cachedRectRef.current || container.getBoundingClientRect();
                return findHitKnobIndex(controlsRef.current, clientX, clientY, rect, {
                    hitRadiusMultiplier: isCompact ? 1.35 : 1.15,
                });
            };

            const setDragHud = (modifier: KnobDragModifier | null) => {
                const hud = dragHudRef.current;
                if (!hud) return;
                if (!modifier || modifier === 'normal') {
                    hud.style.display = 'none';
                    return;
                }
                hud.textContent = modifier === 'coarse' ? 'COARSE' : 'FINE';
                hud.style.color = modifier === 'coarse' ? '#fbbf24' : '#67e8f9';
                hud.style.display = 'block';
            };

            const activateKnob = (hitIndex: number, clientY: number, event: PointerEvent) => {
                activeKnobIndex.current = hitIndex;
                const ctrl = controlsRef.current[hitIndex];
                dragNudgeRef.current = event.altKey && !!ctrl.automationPreview?.laneId;
                const startValue = dragNudgeRef.current && ctrl.isAutomated && ctrl.automatedValue !== undefined
                    ? ctrl.automatedValue
                    : ctrl.value;
                dragAnchorRef.current = createKnobDragAnchor(clientY, startValue, event);
                dragLiveValueRef.current = startValue;
                sliderRefs.current[hitIndex]?.focus();
                onMidiTouch?.(ctrl.id);

                if (ctrl.isAutomated && !event.altKey) {
                    onAutomationPunchIn?.(ctrl.id);
                }

                if (onMidiLearnStart) {
                    longPressKnobIdRef.current = ctrl.id;
                    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
                    longPressTimerRef.current = setTimeout(() => {
                        if (longPressKnobIdRef.current === ctrl.id) {
                            onMidiLearnStart(ctrl.id);
                        }
                    }, 500);
                }
            };

            const cancelLongPress = () => {
                longPressKnobIdRef.current = null;
                if (longPressTimerRef.current) {
                    clearTimeout(longPressTimerRef.current);
                    longPressTimerRef.current = null;
                }
            };

            const tryArcClickToSet = (hitIndex: number, clientX: number, clientY: number): boolean => {
                const k = controlsRef.current[hitIndex];
                const rect = cachedRectRef.current || container.getBoundingClientRect();
                const kCenterX = rect.left + k.x * rect.width;
                const kCenterY = rect.top + k.y * rect.height;
                const dx = clientX - kCenterX;
                const dy = clientY - kCenterY;
                const bodyRadius = k.size * Math.min(rect.width, rect.height);

                if (!isPointerNearArcRing(dx, dy, bodyRadius, KNOB_MATERIAL)) {
                    return false;
                }

                const newVal = valueFromArcPointer(dx, dy, KNOB_MATERIAL.geometry, {
                    min: 0,
                    max: 1,
                    step: 0.05,
                    useDetents: k.enableDetentSnap,
                    material: KNOB_MATERIAL,
                });
                onParamChange(k.id, newVal);
                dragLiveValueRef.current = newVal;
                return true;
            };

            const handlePointerDown = (e: PointerEvent) => {
                if (e.button !== 0) return;
                const hitIndex = findHitKnob(e.clientX, e.clientY);
                if (hitIndex !== -1) {
                    container.setPointerCapture(e.pointerId);
                    activateKnob(hitIndex, e.clientY, e);
                    tryArcClickToSet(hitIndex, e.clientX, e.clientY);
                    if (dragAnchorRef.current) {
                        dragAnchorRef.current.startValue = dragLiveValueRef.current;
                        dragAnchorRef.current.startY = e.clientY;
                    }
                    const modifier = dragAnchorRef.current?.modifier ?? 'normal';
                    setDragHud(modifier);
                    document.body.style.cursor = getKnobDragCursor(modifier, true);
                    e.preventDefault();
                }
            };

            const handlePointerMove = (e: PointerEvent) => {
                if (activeKnobIndex.current === null || !dragAnchorRef.current) return;
                cancelLongPress();
                const activeCtrl = controlsRef.current[activeKnobIndex.current];
                const { value: newVal, modifier } = computeKnobDragValue(
                    dragAnchorRef.current,
                    e.clientY,
                    e,
                    dragLiveValueRef.current,
                    {
                        min: 0,
                        max: 1,
                        step: 0.05,
                        detentSnap: activeCtrl?.enableDetentSnap
                            ? { enabled: true, material: KNOB_MATERIAL }
                            : undefined,
                    }
                );
                dragLiveValueRef.current = newVal;
                if (activeCtrl?.enableDetentSnap && activeCtrl.detentFeedback) {
                    const positions = resolveDetentPositions(KNOB_MATERIAL);
                    const threshold = KNOB_MATERIAL.detents?.snapThreshold ?? 0.035;
                    const idx = snappedDetentIndex(newVal, positions, threshold);
                    if (idx !== null && idx !== lastDetentIndexRef.current) {
                        const mode = activeCtrl.detentFeedback === true ? 'both' : activeCtrl.detentFeedback;
                        notifyDetentCross(mode);
                    }
                    lastDetentIndexRef.current = idx;
                }
                setDragHud(modifier);
                document.body.style.cursor = getKnobDragCursor(modifier, true);
                renderCanvasAt(activeKnobIndex.current);
                const paramId = controlsRef.current[activeKnobIndex.current].id;
                if (dragNudgeRef.current && onAutomationNudge) {
                    const step = automationStore.getState().playbackStep;
                    onAutomationNudge(paramId, newVal, step);
                } else {
                    onParamChange(paramId, newVal);
                }
            };

            const handleContextMenu = (e: MouseEvent) => {
                const hitIndex = findHitKnob(e.clientX, e.clientY);
                if (hitIndex === -1) return;
                e.preventDefault();
                const ctrl = controlsRef.current[hitIndex];
                if (!ctrl.automationPreview?.hasLane || !onAutomationLaneAction) return;
                setAutomationMenu({ x: e.clientX, y: e.clientY, paramId: ctrl.id, scope: 'knob' });
            };

            const handlePointerUp = (e: PointerEvent) => {
                if (activeKnobIndex.current === null) return;
                cancelLongPress();
                try {
                    container.releasePointerCapture(e.pointerId);
                } catch { /* already released */ }
                activeKnobIndex.current = null;
                dragAnchorRef.current = null;
                lastDetentIndexRef.current = null;
                setDragHud(null);
                document.body.style.cursor = 'default';
            };

            const handleWheel = (e: WheelEvent) => {
                const hitIndex = findHitKnob(e.clientX, e.clientY);
                if (hitIndex === -1) return;
                e.preventDefault();
                const direction = e.deltaY > 0 ? -1 : 1;
                const step = e.shiftKey ? 0.1 : (e.altKey ? 0.001 : 0.01);
                const knob = controlsRef.current[hitIndex];
                const newVal = Math.max(0, Math.min(1, knob.value + direction * step));
                onParamChange(knob.id, newVal);
            };

            container.addEventListener('pointerdown', handlePointerDown);
            container.addEventListener('pointermove', handlePointerMove);
            container.addEventListener('pointerup', handlePointerUp);
            container.addEventListener('pointercancel', handlePointerUp);
            container.addEventListener('wheel', handleWheel, { passive: false });
            container.addEventListener('contextmenu', handleContextMenu);

            return () => {
                cancelLongPress();
                observer.disconnect();
                container.removeEventListener('pointerdown', handlePointerDown);
                container.removeEventListener('pointermove', handlePointerMove);
                container.removeEventListener('pointerup', handlePointerUp);
                container.removeEventListener('pointercancel', handlePointerUp);
                container.removeEventListener('wheel', handleWheel);
                container.removeEventListener('contextmenu', handleContextMenu);
            };
        }, [onParamChange, onMidiTouch, onMidiLearnStart, onAutomationNudge, onAutomationPunchIn, onAutomationLaneAction, renderCanvasAt, isCompact]);

        // ResizeObserver to keep knob canvases sized correctly
        useEffect(() => {
            const container = containerRef.current;
            if (!container) return;
            const ro = new ResizeObserver((entries) => {
                const rect = entries[0].contentRect;
                const minDim = Math.min(rect.width, rect.height);
                controlsRef.current.forEach((ctrl, i) => {
                    const canvas = knobCanvasRefs.current[i];
                    if (!canvas) return;
                    const sizePx = ctrl.size * minDim * 2;
                    canvas.style.width = `${sizePx}px`;
                    canvas.style.height = `${sizePx}px`;
                    canvas.style.left = `${ctrl.x * rect.width}px`;
                    canvas.style.top = `${ctrl.y * rect.height}px`;
                    canvas.style.position = 'absolute';
                    canvas.style.transform = 'translate(-50%, -50%)';
                    const dpr = window.devicePixelRatio || 1;
                    const targetW = Math.max(1, Math.floor(sizePx * dpr));
                    const targetH = Math.max(1, Math.floor(sizePx * dpr));
                    if (canvas.width !== targetW || canvas.height !== targetH) {
                        canvas.width = targetW;
                        canvas.height = targetH;
                    }
                    if (knobHandlesRef.current[i] === null) {
                        renderKnob2D(canvas, getCanvasValueAt(i), KNOB_MATERIAL, getAutomationOverlayAt(i));
                    }
                });
            });
            ro.observe(container);
            return () => ro.disconnect();
        }, []);

        const setKnobCanvasRef = useCallback((index: number) => (el: HTMLCanvasElement | null) => {
            const oldCanvas = knobCanvasRefs.current[index];
            if (oldCanvas === el) return;
            const oldHandle = knobHandlesRef.current[index];
            if (oldHandle) {
                KnobGPUContext.unregister(oldHandle);
                knobHandlesRef.current[index] = null;
            }
            knobCanvasRefs.current[index] = el;
            if (!el) return;

            const container = el.parentElement as HTMLDivElement | null;
            if (container) {
                const rect = container.getBoundingClientRect();
                const minDim = Math.min(rect.width, rect.height);
                const ctrl = controlsRef.current[index];
                if (ctrl) {
                    const sizePx = ctrl.size * minDim * 2;
                    el.style.width = `${sizePx}px`;
                    el.style.height = `${sizePx}px`;
                    el.style.left = `${ctrl.x * rect.width}px`;
                    el.style.top = `${ctrl.y * rect.height}px`;
                    el.style.position = 'absolute';
                    el.style.transform = 'translate(-50%, -50%)';
                    const dpr = window.devicePixelRatio || 1;
                    el.width = Math.max(1, Math.floor(sizePx * dpr));
                    el.height = Math.max(1, Math.floor(sizePx * dpr));
                }
            }

            const handle = KnobGPUContext.register(el, () => getCanvasValueAt(index));
            knobHandlesRef.current[index] = handle;
            if (!handle || !KnobGPUContext.isSlotActive(handle)) {
                renderCanvasAt(index);
            }
        }, [getCanvasValueAt, renderCanvasAt]);

        useEffect(() => {
            return KnobGPUContext.onStatusChange(() => {
                controlsRef.current.forEach((_, i) => {
                    const h = knobHandlesRef.current[i];
                    if (!h || !KnobGPUContext.isSlotActive(h)) {
                        renderCanvasAt(i);
                    }
                });
            });
        }, [renderCanvasAt]);

        const handleHeaderContextMenu = useCallback((e: React.MouseEvent) => {
            if (!automationTarget || !onAutomationLaneAction) return;
            e.preventDefault();
            setAutomationMenu({ x: e.clientX, y: e.clientY, scope: 'panel' });
        }, [automationTarget, onAutomationLaneAction]);

        const showAutomationOverlay = showHardwareAutomation;

        const closeAutomationMenu = useCallback(() => setAutomationMenu(null), []);

        useEffect(() => {
            if (!automationMenu) return;
            const onDocClick = () => closeAutomationMenu();
            document.addEventListener('click', onDocClick);
            return () => document.removeEventListener('click', onDocClick);
        }, [automationMenu, closeAutomationMenu]);

        return (
            <div ref={containerRef} className={`relative rounded-lg shadow-xl bg-gray-900 border border-gray-700 touch-none hyphon-rack-surface ${children ? 'overflow-visible' : 'overflow-hidden'}`} style={{ width: '100%', height: '100%', minHeight: isCompact ? '260px' : '220px' }}>
                {automationMenu && onAutomationLaneAction && (
                    <div
                        className="fixed z-[100] min-w-[140px] bg-zinc-950 border border-cyan-800/50 rounded shadow-lg py-1 text-[10px] font-mono"
                        style={{ left: automationMenu.x, top: automationMenu.y }}
                        role="menu"
                    >
                        <button
                            type="button"
                            className="block w-full text-left px-3 py-1.5 hover:bg-cyan-950/50 text-cyan-200"
                            onClick={() => {
                                onAutomationLaneAction('toggle', automationMenu.paramId);
                                closeAutomationMenu();
                            }}
                        >
                            {automationMenu.scope === 'panel' ? 'Toggle all lanes' : 'Toggle lane'}
                        </button>
                        <button
                            type="button"
                            className="block w-full text-left px-3 py-1.5 hover:bg-red-950/40 text-red-300"
                            onClick={() => {
                                onAutomationLaneAction('clear', automationMenu.paramId);
                                closeAutomationMenu();
                            }}
                        >
                            {automationMenu.scope === 'panel' ? 'Clear all lanes' : 'Clear lane'}
                        </button>
                        <button
                            type="button"
                            className="block w-full text-left px-3 py-1.5 text-gray-500 hover:bg-zinc-900"
                            onClick={closeAutomationMenu}
                        >
                            Cancel
                        </button>
                    </div>
                )}
                <div
                    ref={dragHudRef}
                    className="absolute top-1 right-2 z-50 hidden text-[9px] font-mono font-bold tracking-widest px-1.5 py-0.5 rounded bg-black/85 pointer-events-none"
                    aria-hidden="true"
                />
                {controls.map((c, i) => (
                    <canvas
                        key={c.id}
                        ref={setKnobCanvasRef(i)}
                        data-testid={`hardware-knob-canvas-${String(c.id).replace(KNOB_TEST_ID_SANITIZE_PATTERN, '_')}`}
                        className="block"
                        style={{ position: 'absolute', pointerEvents: 'none' }}
                    />
                ))}
                <div className="absolute inset-0 pointer-events-none">
                    <div
                        className="absolute top-2 left-4 flex items-center gap-2 border-b border-white/20 pb-1 w-auto max-w-[90%] pointer-events-auto"
                        onContextMenu={handleHeaderContextMenu}
                    >
                        <span className="text-xs font-orbitron font-bold text-white/50 tracking-widest">{title.toUpperCase()}</span>
                        {titleBadge}
                        {automationTarget && (
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); automationStore.toggleShowHardwareAutomation(); }}
                                className={`text-[7px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border pointer-events-auto ${
                                    showAutomationOverlay
                                        ? 'bg-cyan-900/80 text-cyan-200 border-cyan-500/60'
                                        : 'bg-gray-900/80 text-gray-500 border-gray-700'
                                }`}
                                title="Toggle automation curve overlay on knobs"
                                aria-pressed={showAutomationOverlay}
                            >
                                AUTO
                            </button>
                        )}
                    </div>

                    {controls.map((c, i) => (
                        <KnobOverlay
                            key={c.id}
                            id={c.id}
                            label={c.label}
                            x={c.x}
                            y={c.y}
                            size={c.size}
                            value={c.value}
                            valueDisplay={c.valueDisplay}
                            isRecording={c.isRecording}
                            isAutomated={c.isAutomated}
                            automatedValue={c.automatedValue}
                            isMidiMapped={c.isMidiMapped ?? isMidiMapped?.(c.id)}
                            isMidiActive={c.isMidiActive ?? isMidiActive?.(c.id)}
                            automationPreview={c.automationPreview}
                            automationDimmed={c.automationDimmed}
                            showAutomationOverlay={showAutomationOverlay}
                            indicatorValue={
                                (c.isAutomated || c.isRecording)
                                    ? (c.isAutomated && c.automatedValue !== undefined ? c.automatedValue : c.value)
                                    : undefined
                            }
                            colorHex={colorHex}
                            index={i}
                            onParamChange={onParamChange}
                            onRecordToggle={onRecordToggle}
                            onRegisterRef={handleRegisterRef}
                            compact={isCompact}
                        />
                    ))}
                </div>
                {children && <div className="absolute inset-0 pointer-events-none">{children}</div>}
            </div>
        );
    });
