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
        let zoom = 2;
        vi.useFakeTimers();
        const onZoomChange = vi.fn().mockImplementation((newZoom: number) => {
            zoom = newZoom;
        });
        const { result } = renderHook(() =>
            useTimelineZoom({ containerRef, zoom, onZoomChange })
        );
        act(() => {
            result.current.handleDoubleClick();
            vi.runAllTimers();
        });
        expect(onZoomChange).toHaveBeenCalledWith(DEFAULT_ZOOM);
        expect(zoom).toBe(DEFAULT_ZOOM);
        vi.useRealTimers();
    });

    it('zooms in on Ctrl+wheel with negative deltaY', () => {
        let zoom = 1;
        vi.useFakeTimers();
        const fireWheel = captureListener(container, 'wheel');

        const onZoomChange = vi.fn().mockImplementation((newZoom: number) => {
            zoom = newZoom;
        });

        renderHook(() => useTimelineZoom({ containerRef, zoom, onZoomChange }));

        act(() => {
            fireWheel({ ctrlKey: true, metaKey: false, deltaY: -100, preventDefault: vi.fn() });
            vi.runAllTimers();
        });

        // deltaY = -100, -(−100)*0.001 = +0.1 → zoom 1.0 → 1.1
        expect(onZoomChange).toHaveBeenCalled();
        expect(zoom).toBeCloseTo(1.1, 1);
        vi.useRealTimers();
    });

    it('zooms out on Ctrl+wheel with positive deltaY', () => {
        let zoom = 2;
        vi.useFakeTimers();
        const fireWheel = captureListener(container, 'wheel');

        const onZoomChange = vi.fn().mockImplementation((newZoom: number) => {
            zoom = newZoom;
        });

        renderHook(() => useTimelineZoom({ containerRef, zoom, onZoomChange }));

        act(() => {
            fireWheel({ ctrlKey: true, metaKey: false, deltaY: 100, preventDefault: vi.fn() });
            vi.runAllTimers();
        });

        // deltaY = +100, -(100)*0.001 = -0.1 → zoom 2.0 → 1.9
        expect(onZoomChange).toHaveBeenCalled();
        expect(zoom).toBeCloseTo(1.9, 1);
        vi.useRealTimers();
    });

    it('does NOT zoom on plain wheel (no Ctrl key)', () => {
        let zoom = 1;
        vi.useFakeTimers();
        const fireWheel = captureListener(container, 'wheel');

        const onZoomChange = vi.fn().mockImplementation((newZoom: number) => {
            zoom = newZoom;
        });

        renderHook(() => useTimelineZoom({ containerRef, zoom, onZoomChange }));

        act(() => {
            fireWheel({ ctrlKey: false, metaKey: false, deltaY: -200, preventDefault: vi.fn() });
            vi.runAllTimers();
        });

        expect(onZoomChange).not.toHaveBeenCalled();
        expect(zoom).toBe(1);
        vi.useRealTimers();
    });

    it('clamps zoom to MIN_ZOOM on large outward scroll', () => {
        let zoom = 0.6;
        vi.useFakeTimers();
        const fireWheel = captureListener(container, 'wheel');

        const onZoomChange = vi.fn().mockImplementation((newZoom: number) => {
            zoom = newZoom;
        });

        renderHook(() => useTimelineZoom({ containerRef, zoom, onZoomChange }));

        act(() => {
            fireWheel({ ctrlKey: true, metaKey: false, deltaY: 10000, preventDefault: vi.fn() });
            vi.runAllTimers();
        });

        expect(zoom).toBe(MIN_ZOOM);
        vi.useRealTimers();
    });

    it('clamps zoom to MAX_ZOOM on large inward scroll', () => {
        let zoom = 3.8;
        vi.useFakeTimers();
        const fireWheel = captureListener(container, 'wheel');

        const onZoomChange = vi.fn().mockImplementation((newZoom: number) => {
            zoom = newZoom;
        });

        renderHook(() => useTimelineZoom({ containerRef, zoom, onZoomChange }));

        act(() => {
            fireWheel({ ctrlKey: true, metaKey: false, deltaY: -10000, preventDefault: vi.fn() });
            vi.runAllTimers();
        });

        expect(zoom).toBe(MAX_ZOOM);
        vi.useRealTimers();
    });

    it('resets zoom to DEFAULT_ZOOM on double pointer tap', () => {
        let zoom = 2.5;
        vi.useFakeTimers();
        const firePointerDown = captureListener(container, 'pointerdown');

        const onZoomChange = vi.fn().mockImplementation((newZoom: number) => {
            zoom = newZoom;
        });

        renderHook(() => useTimelineZoom({ containerRef, zoom, onZoomChange }));

        act(() => {
            const makeTap = () => ({ isPrimary: true, pointerId: 1, clientX: 10, clientY: 10 });
            firePointerDown(makeTap());
            firePointerDown(makeTap());
            vi.runAllTimers();
        });

        expect(zoom).toBe(DEFAULT_ZOOM);
        vi.useRealTimers();
    });
});
