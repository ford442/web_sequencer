import React, { memo } from 'react';

export type LedColor = 'off' | 'cyan' | 'green' | 'red' | 'yellow' | 'purple';
export type LedSize = 'sm' | 'md';

interface LedIndicatorProps {
  color?: LedColor;
  size?: LedSize;
  pulse?: boolean;
  className?: string;
  'aria-label'?: string;
}

export const LedIndicator = memo(({
  color = 'off',
  size = 'md',
  pulse = false,
  className = '',
  'aria-label': ariaLabel,
}: LedIndicatorProps) => (
  <span
    className={`hyphon-led hyphon-led--${size} hyphon-led--${color} ${pulse ? 'hyphon-led--pulse' : ''} ${className}`}
    role={ariaLabel ? 'img' : undefined}
    aria-label={ariaLabel}
    aria-hidden={ariaLabel ? undefined : true}
  />
));

LedIndicator.displayName = 'LedIndicator';

interface PanelTitleBarProps {
  title: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  onContextMenu?: (e: React.MouseEvent) => void;
}

export const PanelTitleBar = memo(({
  title,
  badge,
  actions,
  className = '',
  onContextMenu,
}: PanelTitleBarProps) => (
  <div
    className={`absolute top-2 left-4 right-4 flex items-center gap-2 hyphon-panel-title pointer-events-auto z-10 ${className}`}
    onContextMenu={onContextMenu}
  >
    <span className="truncate">{title.toUpperCase()}</span>
    {badge}
    <div className="flex-1" />
    {actions}
  </div>
));

PanelTitleBar.displayName = 'PanelTitleBar';
