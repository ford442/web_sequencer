import { useCallback, useEffect, useRef, useState } from 'react';
import { KNOB_MATERIAL, normalizedFromWgslAngle, resolveDetentPositions } from '../components/knobMaterial';
import type { KnobMaterial } from '../components/knobMaterial';
import {
    computeKnobDragValue,
    createKnobDragAnchor,
    getKnobCanvasValue,
    getKnobDragCursor,
    isPointerNearArcRing,
    valueFromArcPointer,
    wgslAngleFromPointer,
    type KnobDragAnchor,
    type KnobDragModifier,
    type KnobCanvasValueSource,
    type KnobDetentSnapOptions,
} from '../components/knobInteraction';
import { knobAriaLabel, KNOB_AUTOMATION_DESCRIPTION } from '../components/KnobAutomationChrome';
import { knobValueToNormalized } from '../components/knobRender';
import { notifyDetentCross, snappedDetentIndex } from '../components/knobDetentFeedback';

export type KnobInteractionAxis = 'vertical' | 'horizontal';

export interface UseKnobInteractionOptions {
    value: number;
    min: number;
    max: number;
    step?: number;
    logarithmic?: boolean;
    onChange: (value: number) => void;
    defaultValue?: number;
    label?: string;
    /** vertical = rotary drag; horizontal = slider drag */
    axis?: KnobInteractionAxis;
    /** When true, clicks on the arc ring set value directly (rotary knobs). */
    arcClick?: boolean;
    isAutomated?: boolean;
    /** Live automated value in normalized 0–1 space (rack knobs). */
    automatedValue?: number;
    /** Optional formatter for aria-valuetext */
    formatValue?: (value: number) => string;
    /** Called after each live drag update (e.g. to repaint a 2D canvas). */
    onDragValue?: (value: number) => void;
    /** Opt-in magnetic detent snap during drag. */
    detentSnap?: boolean;
    /** Material used for detent positions / thresholds. */
    material?: KnobMaterial;
    /** Play haptic/audio when crossing into a detent. */
    detentFeedback?: boolean | 'audio' | 'haptic' | 'both';
}

function clampAndStep(
    raw: number,
    min: number,
    max: number,
    step?: number,
    skipStep = false
): number {
    let next = Math.max(min, Math.min(max, raw));
    if (!skipStep && step !== undefined && step > 0) {
        next = Math.round(next / step) * step;
    }
    return Math.max(min, Math.min(max, next));
}

function modifierStepMultiplier(event: { shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }): number {
    if (event.shiftKey) return 10;
    if (event.altKey || event.ctrlKey || event.metaKey) return 0.1;
    return 1;
}

export function useKnobInteraction({
    value,
    min,
    max,
    step,
    logarithmic = false,
    onChange,
    defaultValue,
    label = '',
    axis = 'vertical',
    arcClick = false,
    isAutomated = false,
    automatedValue,
    formatValue,
    onDragValue,
    detentSnap = false,
    material = KNOB_MATERIAL,
    detentFeedback = false,
}: UseKnobInteractionOptions) {
    const propsRef = useRef({ value, min, max, step, logarithmic, onChange, defaultValue, onDragValue, detentSnap, material, detentFeedback });
    propsRef.current = { value, min, max, step, logarithmic, onChange, defaultValue, onDragValue, detentSnap, material, detentFeedback };

    const isDraggingRef = useRef(false);
    const dragAnchorRef = useRef<KnobDragAnchor | null>(null);
    const dragLiveValueRef = useRef(value);
    const horizontalRectRef = useRef<DOMRect | null>(null);
    const lastDetentIndexRef = useRef<number | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [dragModifier, setDragModifier] = useState<KnobDragModifier | null>(null);
    const [dragValue, setDragValue] = useState<number | null>(null);

    useEffect(() => {
        if (!isDraggingRef.current) {
            dragLiveValueRef.current = value;
        }
    }, [value]);

    const canvasSource: KnobCanvasValueSource = {
        value: knobValueToNormalized(value, min, max),
        isAutomated,
        automatedValue,
    };
    const displayValue = dragValue ?? (
        isAutomated && automatedValue !== undefined
            ? min + getKnobCanvasValue(canvasSource) * (max - min)
            : value
    );
    const valueText = formatValue ? formatValue(displayValue) : `${displayValue}`;

    const emitChange = useCallback((next: number) => {
        dragLiveValueRef.current = next;
        setDragValue(next);
        propsRef.current.onDragValue?.(next);

        const {
            min: currentMin,
            max: currentMax,
            detentSnap: snapEnabled,
            material: currentMaterial,
            detentFeedback: feedback,
        } = propsRef.current;

        if (snapEnabled && feedback) {
            const positions = resolveDetentPositions(currentMaterial);
            const threshold = currentMaterial.detents?.snapThreshold ?? 0.035;
            const norm = knobValueToNormalized(next, currentMin, currentMax);
            const idx = snappedDetentIndex(norm, positions, threshold);
            if (idx !== null && idx !== lastDetentIndexRef.current) {
                const mode = feedback === true ? 'both' : feedback;
                notifyDetentCross(mode);
            }
            lastDetentIndexRef.current = idx;
        }

        propsRef.current.onChange(next);
    }, []);

    const finishDrag = useCallback(() => {
        isDraggingRef.current = false;
        dragAnchorRef.current = null;
        horizontalRectRef.current = null;
        lastDetentIndexRef.current = null;
        setDragModifier(null);
        setIsDragging(false);
        setDragValue(null);
        document.body.style.cursor = 'default';
    }, []);

    const handlePointerMove = useCallback((e: PointerEvent) => {
        if (!isDraggingRef.current) return;
        const { min: currentMin, max: currentMax, step: currentStep, logarithmic: currentLog } = propsRef.current;

        if (axis === 'horizontal' && horizontalRectRef.current) {
            const rect = horizontalRectRef.current;
            const x = e.clientX - rect.left;
            const normalized = Math.max(currentMin, Math.min(currentMax, (x / rect.width) * (currentMax - currentMin) + currentMin));
            emitChange(normalized);
            return;
        }

        if (!dragAnchorRef.current) return;
        const detentSnapOptions: KnobDetentSnapOptions | undefined = propsRef.current.detentSnap
            ? { enabled: true, material: propsRef.current.material }
            : undefined;
        const { value: newValue, modifier } = computeKnobDragValue(
            dragAnchorRef.current,
            e.clientY,
            e,
            dragLiveValueRef.current,
            {
                min: currentMin,
                max: currentMax,
                step: currentStep,
                logarithmic: currentLog,
                detentSnap: detentSnapOptions,
            }
        );
        setDragModifier(modifier);
        document.body.style.cursor = getKnobDragCursor(modifier, true);
        emitChange(newValue);
    }, [axis, emitChange]);

    const handlePointerUp = useCallback(() => {
        finishDrag();
    }, [finishDrag]);

    useEffect(() => {
        document.addEventListener('pointermove', handlePointerMove);
        document.addEventListener('pointerup', handlePointerUp);
        document.addEventListener('pointercancel', handlePointerUp);
        return () => {
            document.removeEventListener('pointermove', handlePointerMove);
            document.removeEventListener('pointerup', handlePointerUp);
            document.removeEventListener('pointercancel', handlePointerUp);
        };
    }, [handlePointerMove, handlePointerUp]);

    const handlePointerDown = useCallback((e: React.PointerEvent) => {
        const target = e.currentTarget as Element;
        if (typeof target.setPointerCapture === 'function') {
            target.setPointerCapture(e.pointerId);
        }
        e.preventDefault();
        if (target instanceof HTMLElement) target.focus();

        const { min: currentMin, max: currentMax, step: currentStep, logarithmic: currentLog, onChange: currentOnChange } = propsRef.current;
        let startValue = value;

        if (axis === 'horizontal') {
            const rect = target.getBoundingClientRect();
            horizontalRectRef.current = rect;
            const x = e.clientX - rect.left;
            startValue = clampAndStep(
                currentMin + (x / rect.width) * (currentMax - currentMin),
                currentMin,
                currentMax,
                currentStep
            );
            currentOnChange(startValue);
        } else if (arcClick) {
            const rect = target.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const dx = e.clientX - cx;
            const dy = e.clientY - cy;
            const bodyRadius = rect.width / 2;

            if (isPointerNearArcRing(dx, dy, bodyRadius, KNOB_MATERIAL)) {
                if (currentLog) {
                    const effectiveMin = currentMin <= 0 ? 0.001 : currentMin;
                    const logMin = Math.log(effectiveMin);
                    const logMax = Math.log(currentMax);
                    const normalized = normalizedFromWgslAngle(wgslAngleFromPointer(dx, dy), KNOB_MATERIAL.geometry);
                    startValue = Math.exp(logMin + normalized * (logMax - logMin));
                } else {
                    startValue = valueFromArcPointer(dx, dy, KNOB_MATERIAL.geometry, {
                        min: currentMin,
                        max: currentMax,
                        step: currentStep,
                        useDetents: propsRef.current.detentSnap,
                        material: propsRef.current.material,
                    });
                }
                startValue = clampAndStep(startValue, currentMin, currentMax, currentStep);
                currentOnChange(startValue);
            }
        }

        isDraggingRef.current = true;
        setIsDragging(true);
        dragLiveValueRef.current = startValue;
        setDragValue(startValue);
        dragAnchorRef.current = createKnobDragAnchor(e.clientY, startValue, e);
        setDragModifier(dragAnchorRef.current.modifier);
        document.body.style.cursor = getKnobDragCursor(dragAnchorRef.current.modifier, true);
    }, [arcClick, axis, value]);

    const handleWheel = useCallback((e: React.WheelEvent) => {
        e.preventDefault();
        const direction = e.deltaY > 0 ? -1 : 1;
        const { min: currentMin, max: currentMax, step: currentStep, onChange: currentOnChange } = propsRef.current;
        const multiplier = modifierStepMultiplier(e);
        const effectiveStep = (currentStep ?? (currentMax - currentMin) / 100) * multiplier;
        const next = clampAndStep(value + direction * effectiveStep, currentMin, currentMax, currentStep);
        currentOnChange(next);
    }, [value]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        const { min: currentMin, max: currentMax, step: currentStep, onChange: currentOnChange, defaultValue: currentDefault } = propsRef.current;
        const isFine = e.altKey || e.ctrlKey || e.metaKey;
        const multiplier = e.shiftKey ? 10 : (isFine ? 0.1 : 1);
        const effectiveStep = (currentStep ?? (currentMax - currentMin) / 100) * multiplier;

        let next = value;
        let handled = false;

        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
            next += effectiveStep;
            handled = true;
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
            next -= effectiveStep;
            handled = true;
        } else if (e.key === 'PageUp') {
            next += effectiveStep * 5;
            handled = true;
        } else if (e.key === 'PageDown') {
            next -= effectiveStep * 5;
            handled = true;
        } else if (e.key === 'Home') {
            next = currentMin;
            handled = true;
        } else if (e.key === 'End') {
            next = currentMax;
            handled = true;
        }

        if (handled) {
            e.preventDefault();
            currentOnChange(clampAndStep(next, currentMin, currentMax, currentStep, isFine));
        } else if (e.key === 'Enter' && currentDefault !== undefined) {
            e.preventDefault();
            currentOnChange(currentDefault);
        }
    }, [value]);

    const handleDoubleClick = useCallback(() => {
        const { min: currentMin, defaultValue: currentDefault, onChange: currentOnChange } = propsRef.current;
        currentOnChange(currentDefault ?? currentMin);
    }, []);

    const ariaLabel = knobAriaLabel(label, isAutomated);

    return {
        isDragging,
        dragModifier,
        displayValue,
        interactionProps: {
            onPointerDown: handlePointerDown,
            onWheel: handleWheel,
            onKeyDown: handleKeyDown,
            onDoubleClick: handleDoubleClick,
            style: { touchAction: 'none' as const },
            role: 'slider' as const,
            tabIndex: 0,
            'aria-label': ariaLabel,
            'aria-valuemin': min,
            'aria-valuemax': max,
            'aria-valuenow': displayValue,
            'aria-valuetext': valueText,
            'aria-orientation': axis === 'horizontal' ? ('horizontal' as const) : ('vertical' as const),
            'aria-description': isAutomated ? KNOB_AUTOMATION_DESCRIPTION : undefined,
        },
    };
}
