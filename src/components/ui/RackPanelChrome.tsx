import React, { memo } from 'react';

type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

const CORNER_STYLES: Record<Corner, React.CSSProperties> = {
  'top-left': { top: '0.75rem', left: '0.75rem' },
  'top-right': { top: '0.75rem', right: '0.75rem' },
  'bottom-left': { bottom: '0.75rem', left: '0.75rem' },
  'bottom-right': { bottom: '0.75rem', right: '0.75rem' },
};

interface RackScrewProps {
  corner: Corner;
  /** Sticky positioning for horizontally scrollable panels (sequencer). */
  sticky?: boolean;
  className?: string;
}

export const RackScrew = memo(({ corner, sticky = false, className = '' }: RackScrewProps) => (
  <div
    className={`absolute hyphon-screw ${className}`}
    style={{
      ...CORNER_STYLES[corner],
      ...(sticky
        ? {
            position: 'sticky' as const,
            left: corner.endsWith('left') ? '0.75rem' : 'calc(100% - 1.75rem)',
            top: corner.startsWith('top') ? '0.75rem' : undefined,
            bottom: corner.startsWith('bottom') ? '0.75rem' : undefined,
          }
        : {}),
    }}
    aria-hidden="true"
  >
    <div className="hyphon-screw__slot" />
  </div>
));

RackScrew.displayName = 'RackScrew';

interface PanelVentsProps {
  count?: number;
  className?: string;
}

export const PanelVents = memo(({ count = 5, className = '' }: PanelVentsProps) => (
  <div className={`hyphon-vent ${className}`} aria-hidden="true">
    {Array.from({ length: count }, (_, i) => (
      <div key={i} className="hyphon-vent__slot" />
    ))}
  </div>
));

PanelVents.displayName = 'PanelVents';

interface RackPanelChromeProps {
  /** Show corner screws. @default true */
  screws?: boolean;
  /** Show top-center vent strip. @default false */
  vents?: boolean;
  /** Sticky screws for scrollable panels. */
  stickyScrews?: boolean;
  className?: string;
}

/** Shared decorative chrome: corner screws, optional vents, inner glass rim (via parent .hyphon-chrome-panel). */
export const RackPanelChrome = memo(({
  screws = true,
  vents = false,
  stickyScrews = false,
  className = '',
}: RackPanelChromeProps) => (
  <div className={`absolute inset-0 pointer-events-none z-[2] ${className}`} aria-hidden="true">
    {screws && (
      <>
        <RackScrew corner="top-left" sticky={stickyScrews} />
        <RackScrew corner="top-right" sticky={stickyScrews} />
        <RackScrew corner="bottom-left" sticky={stickyScrews} />
        <RackScrew corner="bottom-right" sticky={stickyScrews} />
      </>
    )}
    {vents && (
      <div className="absolute top-2 left-1/2 -translate-x-1/2">
        <PanelVents />
      </div>
    )}
  </div>
));

RackPanelChrome.displayName = 'RackPanelChrome';
