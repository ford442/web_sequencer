import React from 'react';

const AUTO_COLOR = '#00e5ff';

interface KnobAutomationRingProps {
    className?: string;
    style?: React.CSSProperties;
}

/** Cyan pulsing ring shown around knobs driven by automation lanes. */
export const KnobAutomationRing: React.FC<KnobAutomationRingProps> = ({ className = '', style }) => (
    <div
        className={`absolute rounded-full pointer-events-none animate-pulse ${className}`}
        style={{
            border: `2px solid ${AUTO_COLOR}`,
            boxShadow: `0 0 8px ${AUTO_COLOR}, 0 0 16px ${AUTO_COLOR}60`,
            ...style,
        }}
        aria-hidden="true"
    />
);

interface KnobAutomationValueProps {
    children: React.ReactNode;
    className?: string;
    showAutoBadge?: boolean;
}

/** Value readout styled for automated parameters. */
export const KnobAutomationValue: React.FC<KnobAutomationValueProps> = ({
    children,
    className = '',
    showAutoBadge = false,
}) => (
    <div className={className}>
        {showAutoBadge && (
            <span
                className="text-[8px] font-bold uppercase tracking-widest px-0.5 rounded"
                style={{ color: AUTO_COLOR, textShadow: `0 0 6px ${AUTO_COLOR}` }}
            >
                AUTO
            </span>
        )}
        <div
            className={showAutoBadge ? 'leading-tight' : undefined}
            style={{ color: AUTO_COLOR, textShadow: `0 0 4px ${AUTO_COLOR}80` }}
        >
            {children}
        </div>
    </div>
);

export function knobAriaLabel(label: string, isAutomated?: boolean): string {
    return isAutomated ? `${label} (automated)` : label;
}

export const KNOB_AUTOMATION_DESCRIPTION =
    'This parameter is currently driven by an automation lane';
