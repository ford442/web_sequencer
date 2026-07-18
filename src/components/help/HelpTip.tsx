import React, { memo, useCallback, useEffect, useId, useRef, useState } from 'react';
import { getHelpTopic } from '../../content/helpTopics';
import { helpDiscoveryStore } from '../../stores/helpDiscoveryStore';

type HelpTipPosition = 'top' | 'bottom' | 'left' | 'right';

export interface HelpTipProps {
  /** Help topic id from helpTopics.ts */
  topicId: string;
  children: React.ReactElement;
  position?: HelpTipPosition;
  /** Show once until user interacts or dismisses. */
  showOnFirstUse?: boolean;
  className?: string;
}

const POSITION_CLASSES: Record<HelpTipPosition, string> = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  left: 'right-full top-1/2 -translate-y-1/2 mr-2',
  right: 'left-full top-1/2 -translate-y-1/2 ml-2',
};

/**
 * Accessible contextual tooltip tied to the help topic catalog.
 * Visible on hover and keyboard focus; respects prefers-reduced-motion.
 */
export const HelpTip = memo(({
  topicId,
  children,
  position = 'top',
  showOnFirstUse = false,
  className = '',
}: HelpTipProps) => {
  const topic = getHelpTopic(topicId);
  const tipId = useId();
  const [open, setOpen] = useState(false);
  const [firstUsePinned, setFirstUsePinned] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!showOnFirstUse || !topic) return;
    if (!helpDiscoveryStore.hasSeenTip(topicId)) {
      setFirstUsePinned(true);
      setOpen(true);
    }
  }, [showOnFirstUse, topicId, topic]);

  const dismissFirstUse = useCallback(() => {
    helpDiscoveryStore.markTipSeen(topicId);
    setFirstUsePinned(false);
    setOpen(false);
  }, [topicId]);

  const openMore = useCallback(() => {
    dismissFirstUse();
    helpDiscoveryStore.openHelp({ tab: 'guides', topicId });
  }, [dismissFirstUse, topicId]);

  if (!topic) return children;

  const child = React.cloneElement(children, {
    'aria-describedby': open ? tipId : undefined,
    onFocus: (e: React.FocusEvent) => {
      children.props.onFocus?.(e);
      setOpen(true);
    },
    onBlur: (e: React.FocusEvent) => {
      children.props.onBlur?.(e);
      if (!firstUsePinned) setOpen(false);
    },
    onMouseEnter: (e: React.MouseEvent) => {
      children.props.onMouseEnter?.(e);
      setOpen(true);
    },
    onMouseLeave: (e: React.MouseEvent) => {
      children.props.onMouseLeave?.(e);
      if (!firstUsePinned) setOpen(false);
    },
  });

  return (
    <span
      ref={wrapRef}
      className={`relative inline-flex items-center ${className}`}
      onMouseLeave={() => { if (!firstUsePinned) setOpen(false); }}
    >
      {child}
      <span
        id={tipId}
        role="tooltip"
        className={`absolute z-[80] w-56 px-2.5 py-2 rounded-md border border-cyan-900/50 bg-zinc-950/95 text-[11px] text-gray-200 shadow-hyphon-panel pointer-events-auto motion-safe:transition-opacity motion-safe:duration-150 ${
          POSITION_CLASSES[position]
        } ${open ? 'opacity-100 visible' : 'opacity-0 invisible pointer-events-none'}`}
      >
        <span className="block font-bold text-cyan-300/90 mb-1">{topic.title}</span>
        <span className="block text-gray-400 leading-snug">{topic.summary}</span>
        <span className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={openMore}
            className="text-[10px] font-bold text-cyan-400 hover:text-cyan-300 underline focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-500 rounded"
          >
            Learn more
          </button>
          {firstUsePinned && (
            <button
              type="button"
              onClick={dismissFirstUse}
              className="text-[10px] text-gray-500 hover:text-gray-300 focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-500 rounded"
            >
              Dismiss
            </button>
          )}
        </span>
      </span>
    </span>
  );
});

HelpTip.displayName = 'HelpTip';

interface HelpIconButtonProps {
  topicId: string;
  label?: string;
  className?: string;
}

/** Compact ? control — opens the help modal on the given topic. */
export const HelpIconButton = memo(({ topicId, label, className = '' }: HelpIconButtonProps) => {
  const topic = getHelpTopic(topicId);
  const aria = label ?? (topic ? `Contextual help (${topic.id})` : 'Open help');

  return (
    <button
      type="button"
      onClick={() => helpDiscoveryStore.openHelp({ tab: 'guides', topicId })}
      className={`inline-flex items-center justify-center w-4 h-4 rounded-full border border-cyan-800/60 bg-zinc-900/80 text-[9px] font-bold text-cyan-400/80 hover:text-cyan-300 hover:border-cyan-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 ${className}`}
      aria-label={aria}
      title={aria}
    >
      ?
    </button>
  );
});

HelpIconButton.displayName = 'HelpIconButton';
