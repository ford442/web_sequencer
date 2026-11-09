import React from 'react';
import { useChassisKnobMaterial } from './chassisContext';

/** Renders its children only on a HardwareChassis stage. */
export function ChassisOnly({ children }: { children: React.ReactNode }) {
    return useChassisKnobMaterial() ? <>{children}</> : null;
}
