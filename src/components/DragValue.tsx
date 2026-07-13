/**
 * @deprecated Use `HardwareKnob` with `mode="numeric"` instead.
 */
import React from 'react';
import { HardwareKnob } from './HardwareKnob';

export interface DragValueProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  className?: string;
  defaultValue?: number;
}

export const DragValue: React.FC<DragValueProps> = ({
  min = 0,
  max = 100,
  step = 1,
  ...props
}) => (
  <HardwareKnob mode="numeric" min={min} max={max} step={step} label={props.label ?? ''} {...props} />
);

export default DragValue;
