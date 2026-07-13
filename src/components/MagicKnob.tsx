/**
 * @deprecated Use `HardwareKnob` with `mode="holographic"` and `bezel` instead.
 */
import React from 'react';
import { HardwareKnob } from './HardwareKnob';

export interface MagicKnobProps {
    value: number;
    min?: number;
    max?: number;
    label?: string;
    size?: number;
    onChange?: (val: number) => void;
}

export const MagicKnob: React.FC<MagicKnobProps> = ({
    value,
    min = 0,
    max = 100,
    label = 'HOLO',
    size = 100,
    onChange = () => {},
}) => (
    <HardwareKnob
        mode="holographic"
        bezel
        label={label}
        value={value}
        min={min}
        max={max}
        step={(max - min) / 100}
        size={size}
        onChange={onChange}
    />
);
