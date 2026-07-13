/**
 * @deprecated Use `HardwareKnob` with `mode="classic"` instead.
 */
import React from 'react';
import { HardwareKnob, type HardwareKnobColor } from './HardwareKnob';

export interface KnobProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  color?: HardwareKnobColor;
  unit?: string;
  logarithmic?: boolean;
  defaultValue?: number;
  isAutomated?: boolean;
  detentSnap?: boolean;
  detentFeedback?: boolean | 'audio' | 'haptic' | 'both';
  hardwarePointer?: boolean;
}

export const Knob: React.FC<KnobProps> = (props) => (
  <HardwareKnob mode="classic" {...props} />
);
