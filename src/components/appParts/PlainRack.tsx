import type { ReactNode } from 'react';
import { ChassisKnobMaterialContext } from '../chassis/chassisContext';
import { KNOB_MATERIAL_CAP_DARK } from '../knobMaterial';
import { InlinePanelsContext } from './inlinePanelsContext';

/**
 * The plain dark rack: knobs as physical caps (knurled skirt, brushed top, LED
 * value ring, contact shadow) through the same context a HardwareChassis stage
 * uses, so a chassis inside still wins with its own material and a bare
 * HardwareModule elsewhere renders exactly as before. It also lets tall
 * panels dock and expand in it (see inlinePanelsContext).
 */
export function PlainRack({ children }: { children: ReactNode }) {
    return (
        <InlinePanelsContext.Provider value>
            <ChassisKnobMaterialContext.Provider value={KNOB_MATERIAL_CAP_DARK}>
                {children}
            </ChassisKnobMaterialContext.Provider>
        </InlinePanelsContext.Provider>
    );
}
