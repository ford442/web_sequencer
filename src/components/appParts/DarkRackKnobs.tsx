import type { ReactNode } from 'react';
import { ChassisKnobMaterialContext } from '../chassis/chassisContext';
import { KNOB_MATERIAL_CAP_DARK } from '../knobMaterial';

/**
 * The plain dark rack's knobs as physical caps (knurled skirt, brushed top, LED value
 * ring, contact shadow) instead of the flat ring-and-needle. Uses the same context a
 * HardwareChassis stage does, so a chassis inside still wins with its own material and a
 * bare HardwareModule elsewhere renders exactly as before.
 */
export function DarkRackKnobs({ children }: { children: ReactNode }) {
    return (
        <ChassisKnobMaterialContext.Provider value={KNOB_MATERIAL_CAP_DARK}>
            {children}
        </ChassisKnobMaterialContext.Provider>
    );
}
