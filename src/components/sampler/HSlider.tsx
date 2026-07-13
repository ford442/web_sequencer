/**
 * @deprecated Use `HardwareKnob` with `mode="horizontal"` instead.
 */
import React from 'react';
import { HardwareKnob } from '../HardwareKnob';

export interface HSliderProps {
    label: string;
    value: number;
    displayValue: string;
    onChange: (value: number) => void;
    colorHex: [number, number, number];
    isAutomated?: boolean;
}

export const HSlider: React.FC<HSliderProps> = ({ displayValue, ...props }) => (
    <HardwareKnob
        mode="horizontal"
        min={-1}
        max={1}
        step={0.05}
        valueLabel={displayValue}
        {...props}
    />
);
