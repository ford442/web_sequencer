import { createContext, useContext } from 'react';
import type { KnobMaterial } from '../knobMaterial';

/**
 * Set by HardwareChassis for everything rendered on its stage. Panels read it
 * to opt into chassis visuals (knob material, panel artwork) without new props
 * on every call site — the epic's "opt-in through material or attribute" rule.
 * `null` outside a chassis: every consumer renders exactly as before.
 */
export const ChassisKnobMaterialContext = createContext<KnobMaterial | null>(null);

/** Knob material the enclosing chassis asks for, or null outside a chassis. */
export function useChassisKnobMaterial(): KnobMaterial | null {
    return useContext(ChassisKnobMaterialContext);
}

/**
 * The element of the deck under the oscillator knobs, set by a chassis host while that deck is open
 * (oscillator mode on a 303 synth). `ChassisDeckPortal` renders into it; `null` everywhere else.
 */
export const ChassisDeckContext = createContext<HTMLElement | null>(null);
