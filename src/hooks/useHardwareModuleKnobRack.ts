import { useCallback, useEffect, useRef } from 'react';
import { KnobGPUContext, type SlotHandle } from '../components/KnobGPUContext';
import { KNOB_MATERIAL, resolveDetentPositions } from '../components/knobMaterial';
import { renderKnob2D } from '../components/knobRender';
import {
    isPointerNearArcRing, valueFromArcPointer, createKnobDragAnchor, computeKnobDragValue,
    getKnobCanvasValue, getKnobDragCursor, type KnobDragAnchor, type KnobDragModifier,
} from '../components/knobInteraction';
import { notifyDetentCross, snappedDetentIndex } from '../components/knobDetentFeedback';
import { findHitKnobIndexFromCanvases } from '../utils/touchHitTesting';
import { automationStore } from '../stores/automationStore';
import { smoothToward, getRecordingBufferValue } from '../utils/knobAutomationCurve';
import type { KnobAutomationOverlayState } from '../components/knobAutomationOverlay';
import type { AutomationTarget } from '../types';
import type { KnobConfig } from '../components/HardwareModule';

export interface UseHardwareModuleKnobRackParams {
    controls: KnobConfig[];
    onParamChange: (id: string, value: number) => void;
    onMidiTouch?: (paramId: string) => void;
    onMidiLearnStart?: (paramId: string) => void;
    automationTarget?: AutomationTarget;
    onAutomationNudge?: (paramId: string, value: number, step: number) => void;
    onAutomationPunchIn?: (paramId: string) => void;
    /** Called on right-click over a knob that has an automation lane; omit to disable the menu entirely. */
    onKnobContextMenu?: (paramId: string, x: number, y: number) => void;
    isCompact: boolean;
}

/**
 * Owns the native pointer/wheel/touch interaction wiring, GPU/2D canvas
 * rendering sync, and drag-HUD plumbing for HardwareModule's knob rack.
 * Split out of HardwareModule.tsx purely to keep that file under the
 * module-size budget — this hook has exactly one caller.
 */
export function useHardwareModuleKnobRack({
    controls, onParamChange, onMidiTouch, onMidiLearnStart, automationTarget,
    onAutomationNudge, onAutomationPunchIn, onKnobContextMenu, isCompact,
}: UseHardwareModuleKnobRackParams) {
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
        const buffers = automationStore.getState().recordingBuffers;
        let buf;
        for (let i = 0; i < buffers.length; i++) {
            const b = buffers[i];
            if (b.target === automationTargetRef.current && b.parameter === ctrl.id && b.isRecording) {
                buf = b;
                break;
            }
        }
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

    // Sync controls ref and drive re-renders when values change
    useEffect(() => {
        controlsRef.current = controls;
        const prev = prevControlsRef.current;
        const handles = knobHandlesRef.current;
        for (let i = 0; i < controls.length; i++) {
            const ctrl = controls[i];
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
                    const handle = handles[i];
                    if (handle && KnobGPUContext.isSlotActive(handle)) {
                        KnobGPUContext.markDirty(handle);
                    } else {
                        renderCanvasAt(i);
                    }
                }
            } else if (!handles[i] || !KnobGPUContext.isSlotActive(handles[i])) {
                // New / remapped control — paint 2D fallback if GPU inactive.
                if (handles[i] === null || handles[i] === undefined) {
                    renderCanvasAt(i);
                }
            }
        }
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

            for (let i = 0; i < controlsRef.current.length; i++) {
                const ctrl = controlsRef.current[i];
                if (!ctrl.isRecording || !automationTargetRef.current) continue;

                let buf;
                for (let j = 0; j < state.recordingBuffers.length; j++) {
                    const b = state.recordingBuffers[j];
                    if (b.target === automationTargetRef.current && b.parameter === ctrl.id && b.isRecording) {
                        buf = b;
                        break;
                    }
                }

                if (!buf || buf.points.length === 0) continue;
                const target = buf.points[buf.points.length - 1].value;
                const prev = smoothedRecordingRef.current[ctrl.id] ?? target;
                const next = smoothToward(prev, target);
                if (Math.abs(next - prev) > 0.0005) {
                    smoothedRecordingRef.current[ctrl.id] = next;
                    dirty = true;
                }
            }

            if (dirty) {
                for (let i = 0; i < controlsRef.current.length; i++) {
                    const handle = knobHandlesRef.current[i];
                    if (handle && KnobGPUContext.isSlotActive(handle)) {
                        KnobGPUContext.markDirty(handle);
                    } else {
                        renderCanvasAt(i);
                    }
                }
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
            return findHitKnobIndexFromCanvases(knobCanvasRefs.current, clientX, clientY, {
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

            const handle = knobHandlesRef.current[hitIndex];
            if (handle) {
                KnobGPUContext.setAnimated(handle, true);
            }

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
            const canvas = knobCanvasRefs.current[hitIndex];
            const kRect = canvas?.getBoundingClientRect();
            const rect = cachedRectRef.current || container.getBoundingClientRect();
            const kCenterX = kRect ? kRect.left + kRect.width / 2 : rect.left + k.x * rect.width;
            const kCenterY = kRect ? kRect.top + kRect.height / 2 : rect.top + k.y * rect.height;
            const dx = clientX - kCenterX;
            const dy = clientY - kCenterY;
            const bodyRadius = kRect
                ? Math.min(kRect.width, kRect.height) / 2
                : k.size * Math.min(rect.width, rect.height);

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
            // The oscillator/voice selectors, REC buttons and HelpTip pins are DOM
            // overlays stacked above the knob canvas, and their hit areas can sit on
            // top of a knob's canvas region. Capturing the pointer here would
            // preventDefault() the click before it reached them, so those controls
            // looked live but did nothing for a real user (E2E had to fall back to
            // synthetic DOM clicks to drive them). Only the canvas itself may start
            // a knob drag. The a11y slider overlay is pointer-events:none, so knob
            // dragging is unaffected.
            const target = e.target as Element | null;
            if (
                target &&
                target !== container &&
                target.closest('button, input, select, textarea, a, [role="button"]')
            ) {
                return;
            }
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
            const activeHandle = knobHandlesRef.current[activeKnobIndex.current];
            if (activeHandle && KnobGPUContext.isSlotActive(activeHandle)) {
                KnobGPUContext.markDirty(activeHandle);
                KnobGPUContext.renderImmediate(activeHandle);
            } else {
                renderCanvasAt(activeKnobIndex.current);
            }
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
            if (!ctrl.automationPreview?.hasLane || !onKnobContextMenu) return;
            onKnobContextMenu(ctrl.id, e.clientX, e.clientY);
        };

        const handlePointerUp = (e: PointerEvent) => {
            if (activeKnobIndex.current === null) return;
            cancelLongPress();
            try {
                container.releasePointerCapture(e.pointerId);
            } catch { /* already released */ }
            const handle = knobHandlesRef.current[activeKnobIndex.current];
            if (handle) {
                KnobGPUContext.setAnimated(handle, false);
            }
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
    }, [onParamChange, onMidiTouch, onMidiLearnStart, onAutomationNudge, onAutomationPunchIn, onKnobContextMenu, renderCanvasAt, isCompact]);

    // ResizeObserver to keep knob canvases sized correctly
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const layoutKnobSlot = (index: number) => {
            const ctrl = controlsRef.current[index];
            const canvas = knobCanvasRefs.current[index];
            const moduleEl = containerRef.current;
            if (!ctrl || !canvas || !moduleEl) return;
            const minDim = Math.min(moduleEl.clientWidth, moduleEl.clientHeight);
            const wrap = canvas.parentElement;
            const sizePx = ctrl.size * minDim * 2;
            if (wrap) {
                wrap.style.width = `${sizePx}px`;
                wrap.style.height = `${sizePx}px`;
            }
            canvas.style.width = '100%';
            canvas.style.height = '100%';
            canvas.style.transform = 'none';
            const handle = knobHandlesRef.current[index];
            if (handle && KnobGPUContext.isSlotActive(handle)) {
                KnobGPUContext.markDirty(handle);
            } else {
                renderKnob2D(canvas, getCanvasValueAt(index), KNOB_MATERIAL, getAutomationOverlayAt(index));
            }
        };

        const ro = new ResizeObserver(() => {
            for (let i = 0; i < controlsRef.current.length; i++) {
                layoutKnobSlot(i);
            }
        });
        ro.observe(container);
        return () => ro.disconnect();
    }, [getCanvasValueAt, getAutomationOverlayAt]);

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

        const wrap = el.parentElement;
        const moduleEl = containerRef.current;
        if (wrap && moduleEl) {
            const minDim = Math.min(moduleEl.clientWidth, moduleEl.clientHeight);
            const ctrl = controlsRef.current[index];
            if (ctrl) {
                const sizePx = ctrl.size * minDim * 2;
                wrap.style.width = `${sizePx}px`;
                wrap.style.height = `${sizePx}px`;
                el.style.width = '100%';
                el.style.height = '100%';
                el.style.transform = 'none';
            }
        }

        const handle = KnobGPUContext.register(el, () => getCanvasValueAt(index));
        knobHandlesRef.current[index] = handle;
        if (!handle || !KnobGPUContext.isSlotActive(handle)) {
            renderCanvasAt(index);
        } else {
            KnobGPUContext.markDirty(handle);
        }
    }, [getCanvasValueAt, renderCanvasAt]);

    useEffect(() => {
        return KnobGPUContext.onStatusChange(() => {
            for (let i = 0; i < controlsRef.current.length; i++) {
                const h = knobHandlesRef.current[i];
                if (!h || !KnobGPUContext.isSlotActive(h)) {
                    renderCanvasAt(i);
                }
            }
        });
    }, [renderCanvasAt]);

    return {
        containerRef,
        dragHudRef,
        sliderRefs,
        handleRegisterRef,
        setKnobCanvasRef,
        getCanvasValueAt,
        getAutomationOverlayAt,
    };
}
