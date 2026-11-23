import { useLayoutEffect, type RefObject } from 'react';

/** CSS custom property carrying the transport header's rendered height, in px. */
export const HEADER_HEIGHT_VAR = '--hyphon-header-h';
/** ...and the bottom bar's. */
export const BOTTOM_BAR_HEIGHT_VAR = '--hyphon-bottom-bar-h';

/**
 * Publishes the header's measured height as `--hyphon-header-h` on :root.
 *
 * The header wraps onto extra rows when the viewport is narrower than its controls, so its height
 * is no longer a constant 48px. Fixed panels that hang under it (Arrangement, Song mode) anchor to
 * this variable instead of a hard-coded `top-16`; otherwise a taller header ends up underneath the
 * panel, and the panel covers the very button that opens it.
 */
export function useHeaderHeightVar(ref: RefObject<HTMLElement | null>): void {
    useElementHeightVar(ref, HEADER_HEIGHT_VAR);
}

/** Same for the bottom bar: panels that sit on top of it (dock, piano roll, history) read the variable. */
export function useBottomBarHeightVar(ref: RefObject<HTMLElement | null>): void {
    useElementHeightVar(ref, BOTTOM_BAR_HEIGHT_VAR);
}

function useElementHeightVar(ref: RefObject<HTMLElement | null>, name: string): void {
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return undefined;
        const root = document.documentElement;
        const publish = () => root.style.setProperty(name, `${Math.ceil(el.getBoundingClientRect().height)}px`);
        publish();
        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', publish);
            return () => {
                window.removeEventListener('resize', publish);
                root.style.removeProperty(name);
            };
        }
        const ro = new ResizeObserver(publish);
        ro.observe(el);
        return () => {
            ro.disconnect();
            root.style.removeProperty(name);
        };
    }, [ref, name]);
}
