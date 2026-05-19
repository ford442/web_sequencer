import { useEffect, useRef, useCallback } from 'react';
import { MIN_ZOOM, MAX_ZOOM, DEFAULT_ZOOM } from '../components/sequencer/constants';

interface UseTimelineZoomOptions {
    containerRef: React.RefObject<HTMLElement | null>;
    zoom: number;
    onZoomChange: (newZoom: number) => void;
}

/** Clamp z to [MIN_ZOOM, MAX_ZOOM] and round to nearest 0.1. */
const clampZoom = (z: number) => Math.round(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z)) * 10) / 10;

/**
 * Attaches pinch-to-zoom (via PointerEvents) and Ctrl+scroll zoom to a
 * timeline container element.  Double-click or double-tap on the container
 * resets the zoom level to 1×.
 *
 * - Pinch detection uses raw PointerEvents (no external library).
 * - Wheel zoom only fires when Ctrl or Meta is held; plain scroll still pans.
 * - Zoom range: MIN_ZOOM (0.5) – MAX_ZOOM (4.0), step 0.1.
 * - ⚡ Bolt: Imperatively updates `--zoom-level` CSS variable to avoid React re-renders during rapid gestures.
 */
export function useTimelineZoom({ containerRef, zoom, onZoomChange }: UseTimelineZoomOptions) {
    // Keep a stable ref so pointer callbacks don't form stale closures over zoom.
    const zoomRef = useRef(zoom);
    useEffect(() => { zoomRef.current = zoom; }, [zoom]);

    const debounceTimeoutRef = useRef<number | null>(null);

    // Imperatively update the CSS variable and debounce the React state update
    const applyZoom = useCallback((newZoom: number) => {
        const clampedZoom = clampZoom(newZoom);
        zoomRef.current = clampedZoom;

        // Bypasses React render cycle completely
        if (containerRef.current) {
            requestAnimationFrame(() => {
                containerRef.current?.style.setProperty('--zoom-level', clampedZoom.toString());
            });
        }

        // Sync with React state after the gesture ends
        if (debounceTimeoutRef.current) {
            window.clearTimeout(debounceTimeoutRef.current);
        }
        debounceTimeoutRef.current = window.setTimeout(() => {
            onZoomChange(clampedZoom);
        }, 150);
    }, [containerRef, onZoomChange]);


    // ── Ctrl+Wheel zoom ──────────────────────────────────────────────────────
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const handleWheel = (e: WheelEvent) => {
            if (!(e.ctrlKey || e.metaKey)) return; // plain scroll → pan, not zoom
            e.preventDefault();
            // deltaY is typically ±100 per notch; multiply by 0.001 → ±0.1 per notch
            applyZoom(zoomRef.current - e.deltaY * 0.001);
        };

        el.addEventListener('wheel', handleWheel, { passive: false });
        return () => el.removeEventListener('wheel', handleWheel);
    }, [containerRef, applyZoom]);

    // ── PointerEvent pinch-to-zoom ───────────────────────────────────────────
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        // Map from pointerId → {x, y}
        const activePointers = new Map<number, { x: number; y: number }>();
        let initialPinchDist: number | null = null;
        let initialPinchZoom = 1;

        const getPinchDist = () => {
            const pts = Array.from(activePointers.values());
            if (pts.length < 2) return null;
            return Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        };

        const handlePointerDown = (e: PointerEvent) => {
            activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (activePointers.size === 2) {
                initialPinchDist = getPinchDist();
                initialPinchZoom = zoomRef.current;
            }
        };

        const handlePointerMove = (e: PointerEvent) => {
            if (!activePointers.has(e.pointerId)) return;
            activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

            if (activePointers.size >= 2 && initialPinchDist !== null) {
                const dist = getPinchDist();
                if (dist === null) return;
                const scale = dist / initialPinchDist;
                applyZoom(initialPinchZoom * scale);
            }
        };

        const handlePointerUp = (e: PointerEvent) => {
            activePointers.delete(e.pointerId);
            if (activePointers.size < 2) {
                initialPinchDist = null;
            }
        };

        el.addEventListener('pointerdown', handlePointerDown);
        el.addEventListener('pointermove', handlePointerMove);
        el.addEventListener('pointerup', handlePointerUp);
        el.addEventListener('pointercancel', handlePointerUp);

        return () => {
            el.removeEventListener('pointerdown', handlePointerDown);
            el.removeEventListener('pointermove', handlePointerMove);
            el.removeEventListener('pointerup', handlePointerUp);
            el.removeEventListener('pointercancel', handlePointerUp);
        };
    }, [containerRef, applyZoom]);

    // ── Double-click / double-tap reset ──────────────────────────────────────
    const lastTapRef = useRef<number>(0);

    const handleDoubleClick = useCallback(() => {
        applyZoom(DEFAULT_ZOOM);
    }, [applyZoom]);

    // For touch double-tap we detect two rapid taps via pointerdown timestamps
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const handlePointerDownForTap = (e: PointerEvent) => {
            // Only track single-touch (primary pointer)
            if (!e.isPrimary) return;
            const now = Date.now();
            if (now - lastTapRef.current < 350) {
                applyZoom(DEFAULT_ZOOM);
            }
            lastTapRef.current = now;
        };

        el.addEventListener('pointerdown', handlePointerDownForTap);
        return () => el.removeEventListener('pointerdown', handlePointerDownForTap);
    }, [containerRef, applyZoom]);

    return { handleDoubleClick };
}

