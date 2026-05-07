import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useTimelineZoom } from '../useTimelineZoom';
import { MIN_ZOOM, MAX_ZOOM, DEFAULT_ZOOM } from '../../components/sequencer/constants';

function makeContainer() {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return el;
}

/** Intercept a named event listener registered via addEventListener and return a fire helper. */
function captureListener(el: HTMLElement, eventType: string): (e: any) => void {
    const captured: Array<(e: any) => void> = [];
    const original = el.addEventListener.bind(el);
    vi.spyOn(el, 'addEventListener').mockImplementation((type: string, handler: any, ...rest: any[]) => {
        if (type === eventType) captured.push(handler);
        original(type, handler, ...rest);
    });
    return (e: any) => captured.forEach(h => h(e));
}

describe('useTimelineZoom', () => {
    let container: HTMLDivElement;
    let containerRef: React.RefObject<HTMLDivElement>;

    beforeEach(() => {
        container = makeContainer();
        containerRef = { current: container };
    });

    afterEach(() => {
        container.remove();
        vi.restoreAllMocks();
    });

    it('exports zoom constants with correct values', () => {
        expect(MIN_ZOOM).toBe(0.5);
        expect(MAX_ZOOM).toBe(4.0);
        expect(DEFAULT_ZOOM).toBe(1.0);
    });

    it('returns handleDoubleClick that resets zoom to DEFAULT_ZOOM', () => {
        const setZoom = vi.fn();
        const { result } = renderHook(() =>
            useTimelineZoom({ containerRef, zoom: 2, setZoom })
        );
        act(() => {
            result.current.handleDoubleClick();
        });
        expect(setZoom).toHaveBeenCalledWith(DEFAULT_ZOOM);
    });

    it('zooms in on Ctrl+wheel with negative deltaY', () => {
        let zoom = 1;
        const fireWheel = captureListener(container, 'wheel');

        const setZoom = vi.fn().mockImplementation((updater: any) => {
            zoom = typeof updater === 'function' ? updater(zoom) : updater;
        });

        renderHook(() => useTimelineZoom({ containerRef, zoom, setZoom }));

        act(() => {
            fireWheel({ ctrlKey: true, metaKey: false, deltaY: -100, preventDefault: vi.fn() });
        });

        // deltaY = -100, -(−100)*0.001 = +0.1 → zoom 1.0 → 1.1
        expect(setZoom).toHaveBeenCalled();
        expect(zoom).toBeCloseTo(1.1, 1);
    });

    it('zooms out on Ctrl+wheel with positive deltaY', () => {
        let zoom = 2;
        const fireWheel = captureListener(container, 'wheel');

        const setZoom = vi.fn().mockImplementation((updater: any) => {
            zoom = typeof updater === 'function' ? updater(zoom) : updater;
        });

        renderHook(() => useTimelineZoom({ containerRef, zoom, setZoom }));

        act(() => {
            fireWheel({ ctrlKey: true, metaKey: false, deltaY: 100, preventDefault: vi.fn() });
        });

        // deltaY = +100, -(100)*0.001 = -0.1 → zoom 2.0 → 1.9
        expect(setZoom).toHaveBeenCalled();
        expect(zoom).toBeCloseTo(1.9, 1);
    });

    it('does NOT zoom on plain wheel (no Ctrl key)', () => {
        let zoom = 1;
        const fireWheel = captureListener(container, 'wheel');

        const setZoom = vi.fn().mockImplementation((updater: any) => {
            zoom = typeof updater === 'function' ? updater(zoom) : updater;
        });

        renderHook(() => useTimelineZoom({ containerRef, zoom, setZoom }));

        act(() => {
            fireWheel({ ctrlKey: false, metaKey: false, deltaY: -200, preventDefault: vi.fn() });
        });

        expect(setZoom).not.toHaveBeenCalled();
        expect(zoom).toBe(1);
    });

    it('clamps zoom to MIN_ZOOM on large outward scroll', () => {
        let zoom = 0.6;
        const fireWheel = captureListener(container, 'wheel');

        const setZoom = vi.fn().mockImplementation((updater: any) => {
            zoom = typeof updater === 'function' ? updater(zoom) : updater;
        });

        renderHook(() => useTimelineZoom({ containerRef, zoom, setZoom }));

        act(() => {
            fireWheel({ ctrlKey: true, metaKey: false, deltaY: 10000, preventDefault: vi.fn() });
        });

        expect(zoom).toBe(MIN_ZOOM);
    });

    it('clamps zoom to MAX_ZOOM on large inward scroll', () => {
        let zoom = 3.8;
        const fireWheel = captureListener(container, 'wheel');

        const setZoom = vi.fn().mockImplementation((updater: any) => {
            zoom = typeof updater === 'function' ? updater(zoom) : updater;
        });

        renderHook(() => useTimelineZoom({ containerRef, zoom, setZoom }));

        act(() => {
            fireWheel({ ctrlKey: true, metaKey: false, deltaY: -10000, preventDefault: vi.fn() });
        });

        expect(zoom).toBe(MAX_ZOOM);
    });

    it('resets zoom to DEFAULT_ZOOM on double pointer tap', () => {
        let zoom = 2.5;
        const firePointerDown = captureListener(container, 'pointerdown');

        const setZoom = vi.fn().mockImplementation((updater: any) => {
            zoom = typeof updater === 'function' ? updater(zoom) : updater;
        });

        renderHook(() => useTimelineZoom({ containerRef, zoom, setZoom }));

        act(() => {
            const makeTap = () => ({ isPrimary: true, pointerId: 1, clientX: 10, clientY: 10 });
            firePointerDown(makeTap());
            firePointerDown(makeTap());
        });

        expect(zoom).toBe(DEFAULT_ZOOM);
    });
});
