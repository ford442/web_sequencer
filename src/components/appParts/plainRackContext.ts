import { createContext, useContext } from 'react';

/**
 * True for everything rendered inside the plain (non-chassis) rack shell in
 * App. That shell is a fixed-height box, so a panel with more content than the
 * knob rack (the sampler's bank / slicing / TTS controls) docks in flow below
 * the knobs and lets the shell grow, instead of floating as a small clipped
 * overlay. `false` elsewhere (chassis, showcases): panels render as before.
 */
export const PlainRackContext = createContext(false);

export function usePlainRack(): boolean {
    return useContext(PlainRackContext);
}
