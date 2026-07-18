/**
 * @deprecated Use `HardwareKnob` with `mode="vertical"` instead.
 */
import React from 'react';
import { HardwareKnob } from '../HardwareKnob';

export interface VerticalKnobProps {
    label: string;
    value: number;
    onChange: (value: number) => void;
    colorHex: [number, number, number];
    isAutomated?: boolean;
}

export const VerticalKnob: React.FC<VerticalKnobProps> = (props) => (
    <HardwareKnob mode="vertical" min={0} max={1} step={0.01} {...props} />
);
