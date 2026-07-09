/** Shared value formatting for knob readouts. */
export function formatKnobValue(val: number, unit = ''): string {
    if (val === undefined || val === null) return '0';
    if (unit === 's' && val < 1) return `${(val * 1000).toFixed(0)}ms`;
    if (unit === 'Hz' && val >= 1000) return `${(val / 1000).toFixed(1)}k`;

    let formatted: string;
    if (val >= 10 || val === 0) formatted = val.toFixed(0);
    else if (val < 0.1) formatted = val.toFixed(3);
    else formatted = val.toFixed(2);

    return `${formatted}${unit || ''}`;
}

/** Compact numeric display for transport-style drag values. */
export function formatDragValue(v: number): string {
    if (v >= 1000) return `${Math.round(v / 100) / 10}k`;
    return `${Math.round(v)}`;
}

/** Format a normalized 0–1 value as a percentage readout. */
export function formatNormalizedPercent(value: number): string {
    return `${Math.round(value * 100)}%`;
}
