import type { ReactNode } from 'react';
import { ChassisKnobMaterialContext } from '../chassis/chassisContext';
import { KNOB_MATERIAL_CAP_DARK } from '../knobMaterial';
import { PlainRackContext } from './plainRackContext';

/**
 * The plain dark rack: knobs as physical caps (knurled skirt, brushed top, LED
 * value ring, contact shadow) through the same context a HardwareChassis stage
 * uses, so a chassis inside still wins with its own material and a bare
 * HardwareModule elsewhere renders exactly as before. It also marks the
 * subtree as the plain rack so tall panels can dock and expand (see
 * plainRackContext).
 */
export function PlainRack({ children }: { children: ReactNode }) {
    return (
        <PlainRackContext.Provider value>
            <ChassisKnobMaterialContext.Provider value={KNOB_MATERIAL_CAP_DARK}>
                {children}
            </ChassisKnobMaterialContext.Provider>
        </PlainRackContext.Provider>
    );
}
