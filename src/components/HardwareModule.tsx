import React, { memo, useRef, useEffect, useCallback } from 'react';
import { KnobGPUContext, type SlotHandle } from './KnobGPUContext';

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
    colorHex: [number, number, number];
    index: number;
    onParamChange: (id: string, value: number) => void;
    onRecordToggle?: (id: string) => void;
    onRegisterRef: (index: number, el: HTMLDivElement | null) => void;
}

const KnobOverlay = memo(({
    id, label, x, y, size, value, valueDisplay, isRecording, isAutomated, automatedValue, colorHex, index, onParamChange, onRecordToggle, onRegisterRef
}: KnobOverlayProps) => {
    return (
        <>
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
                className="absolute text-center transform -translate-x-1/2"
                style={{
                    left: `${x * 100}%`,
                    top: `${(y + size * 0.8) * 100}%`,
                    color: `rgba(${colorHex[0] * 255},${colorHex[1] * 255},${colorHex[2] * 255},0.8)`,
                    zIndex: 10
                }}
            >
                <span className="text-[10px] font-mono font-bold tracking-wider drop-shadow-md">{label}</span>
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

            {/* 2. Record Button */}
            {onRecordToggle && (
                <button
                    onClick={(e) => { e.stopPropagation(); onRecordToggle(id); }}
                    className="absolute pointer-events-auto transform -translate-x-1/2"
                    style={{
                        left: `${x * 100}%`,
                        top: `${(y - size * 1.3) * 100}%`,
                        width: '16px',
                        height: '16px',
                        zIndex: 20
                    }}
                    title="Record Automation"
                    aria-label={`Record Automation for ${label}`}
                    aria-pressed={isRecording}
                >
                    <div className={`w-full h-full rounded-full flex items-center justify-center text-[10px] font-bold ${isRecording ? 'bg-red-600 text-white animate-pulse' : 'bg-gray-800 text-red-500 border border-red-900/50 hover:bg-red-900/30'}`}>R</div>
                </button>
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

/**
 * Renders a single knob using the Canvas 2D API.
 * Called when WebGPU is unavailable so knobs remain visible.
 * Visual contract: dark background, cyan outer ring, cyan-to-teal arc,
 * white needle. Approximates the shared WGSL holographic look.
 */
function renderWith2D(canvas: HTMLCanvasElement, value: number): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const targetW = Math.max(1, Math.floor(rect.width * dpr));
    const targetH = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);
    const w = rect.width;
    const h = rect.height;
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) / 2 * 0.9;

    // Background
    ctx.fillStyle = '#0d0f13';
    ctx.fillRect(0, 0, w, h);

    // Outer ring at ~55% radius
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.55, 0, Math.PI * 2);
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Value arc (270° sweep) with cyan-to-teal gradient
    const startAngle = -0.75 * Math.PI;
    const endAngle = startAngle + value * 1.5 * Math.PI;
    const arcRadius = radius * 0.75;
    const grad = ctx.createLinearGradient(
        cx + Math.cos(startAngle) * arcRadius,
        cy + Math.sin(startAngle) * arcRadius,
        cx + Math.cos(endAngle) * arcRadius,
        cy + Math.sin(endAngle) * arcRadius
    );
    grad.addColorStop(0, '#00e5ff');
    grad.addColorStop(1, '#00897b');
    ctx.beginPath();
    ctx.arc(cx, cy, arcRadius, startAngle, endAngle);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Needle
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(
        cx + Math.cos(endAngle) * radius * 0.55,
        cy + Math.sin(endAngle) * radius * 0.55
    );
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore();
}

export const HardwareModule = memo(
    ({
        title,
        colorHex,
        controls,
        onParamChange,
        onRecordToggle,
        children,
        titleBadge,
        is3D = false
    }: HardwareModuleProps) => {
        const containerRef = useRef<HTMLDivElement>(null);
        const cachedRectRef = useRef<DOMRect | null>(null);
        const controlsRef = useRef(controls);
        const prevControlsRef = useRef<KnobConfig[]>([]);
        const activeKnobIndex = useRef<number | null>(null);
        const startY = useRef(0);
        const startVal = useRef(0);

        const knobCanvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
        const knobHandlesRef = useRef<(SlotHandle | null)[]>([]);

        // Refs for accessibility elements
        const sliderRefs = useRef<(HTMLDivElement | null)[]>([]);

        const handleRegisterRef = useCallback((index: number, el: HTMLDivElement | null) => {
            sliderRefs.current[index] = el;
        }, []);

        // Sync controls ref and drive 2D fallback re-renders when values change
        useEffect(() => {
            controlsRef.current = controls;
            const prev = prevControlsRef.current;
            const handles = knobHandlesRef.current;
            controls.forEach((ctrl, i) => {
                if (handles[i] === null) {
                    const prevCtrl = prev[i];
                    if (prevCtrl && prevCtrl.id === ctrl.id && prevCtrl.value !== ctrl.value) {
                        const canvas = knobCanvasRefs.current[i];
                        if (canvas) renderWith2D(canvas, ctrl.value);
                    }
                }
            });
            prevControlsRef.current = controls;
        }, [controls]);

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
                const scale = Math.max(rect.width, rect.height);
                const normX = (clientX - rect.left) / scale;
                const normY = (clientY - rect.top) / scale;
                return controlsRef.current.findIndex(k => {
                    const kNormX = k.x * rect.width / scale;
                    const kNormY = k.y * rect.height / scale;
                    const dx = kNormX - normX;
                    const dy = kNormY - normY;
                    const kSizeNorm = k.size * Math.min(rect.width, rect.height) / scale;
                    return Math.sqrt(dx * dx + dy * dy) < (kSizeNorm * 1.2);
                });
            };

            const activateKnob = (hitIndex: number, clientY: number) => {
                activeKnobIndex.current = hitIndex;
                startY.current = clientY;
                startVal.current = controlsRef.current[hitIndex].value;
                sliderRefs.current[hitIndex]?.focus();
            };

            const handleMouseDown = (e: MouseEvent) => {
                const hitIndex = findHitKnob(e.clientX, e.clientY);
                if (hitIndex !== -1) {
                    activateKnob(hitIndex, e.clientY);
                    document.body.style.cursor = 'ns-resize';
                    e.preventDefault();
                }
            };

            const handleMouseMove = (e: MouseEvent) => {
                if (activeKnobIndex.current === null) return;
                const dy = startY.current - e.clientY;
                let newVal = startVal.current + (dy * 0.005);
                newVal = Math.max(0, Math.min(1, newVal));
                onParamChange(controlsRef.current[activeKnobIndex.current].id, newVal);
            };

            const handleMouseUp = () => {
                activeKnobIndex.current = null;
                document.body.style.cursor = 'default';
            };

            const handleTouchStart = (e: TouchEvent) => {
                const touch = e.touches[0];
                const hitIndex = findHitKnob(touch.clientX, touch.clientY);
                if (hitIndex !== -1) {
                    activateKnob(hitIndex, touch.clientY);
                    e.preventDefault();
                }
            };

            const handleTouchMove = (e: TouchEvent) => {
                if (activeKnobIndex.current === null) return;
                const touch = e.touches[0];
                const dy = startY.current - touch.clientY;
                let newVal = startVal.current + (dy * 0.005);
                newVal = Math.max(0, Math.min(1, newVal));
                onParamChange(controlsRef.current[activeKnobIndex.current].id, newVal);
                e.preventDefault();
            };

            const handleTouchEnd = () => {
                activeKnobIndex.current = null;
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

            container.addEventListener('mousedown', handleMouseDown);
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
            container.addEventListener('touchstart', handleTouchStart, { passive: false });
            window.addEventListener('touchmove', handleTouchMove, { passive: false });
            window.addEventListener('touchend', handleTouchEnd);
            container.addEventListener('wheel', handleWheel, { passive: false });

            return () => {
                observer.disconnect();
                container.removeEventListener('mousedown', handleMouseDown);
                window.removeEventListener('mousemove', handleMouseMove);
                window.removeEventListener('mouseup', handleMouseUp);
                container.removeEventListener('touchstart', handleTouchStart);
                window.removeEventListener('touchmove', handleTouchMove);
                window.removeEventListener('touchend', handleTouchEnd);
                container.removeEventListener('wheel', handleWheel);
            };
        }, [onParamChange]);

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
                        renderWith2D(canvas, ctrl.value);
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

            const handle = KnobGPUContext.register(el, () => controlsRef.current[index]?.value ?? 0);
            knobHandlesRef.current[index] = handle;
            if (!handle) {
                const ctrl = controlsRef.current[index];
                if (ctrl) renderWith2D(el, ctrl.value);
            }
        }, []);

        return (
            <div ref={containerRef} className={`relative rounded-lg shadow-xl bg-gray-900 border border-gray-700 ${children ? 'overflow-visible' : 'overflow-hidden'}`} style={{ width: '100%', height: '100%', minHeight: '220px' }}>
                {controls.map((c, i) => (
                    <canvas
                        key={c.id}
                        ref={setKnobCanvasRef(i)}
                        className="block"
                        style={{ position: 'absolute', pointerEvents: 'none' }}
                    />
                ))}
                <div className="absolute inset-0 pointer-events-none">
                    <div className="absolute top-2 left-4 flex items-center gap-2 border-b border-white/20 pb-1 w-auto max-w-[90%]">
                        <span className="text-xs font-orbitron font-bold text-white/50 tracking-widest">{title.toUpperCase()}</span>
                        {titleBadge}
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
                            colorHex={colorHex}
                            index={i}
                            onParamChange={onParamChange}
                            onRecordToggle={onRecordToggle}
                            onRegisterRef={handleRegisterRef}
                        />
                    ))}
                </div>
                {children && <div className="absolute inset-0 pointer-events-none">{children}</div>}
            </div>
        );
    });
