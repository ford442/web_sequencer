import { createContext, useContext } from 'react';

/**
 * True where the host gives a rack panel room to grow: the plain rack shell in
 * App, and the chassis stage while it is in SMP mode. A panel with far more
 * content than the knob rack (the sampler's bank / slicing / TTS controls)
 * then docks in flow under the knobs and marks itself `data-rack-expand` so
 * the host can grow to fit, instead of floating as a small clipped overlay.
 * `false` elsewhere (other chassis modes, showcases): the overlay as before.
 */
export const InlinePanelsContext = createContext(false);

export function useInlinePanels(): boolean {
    return useContext(InlinePanelsContext);
}
