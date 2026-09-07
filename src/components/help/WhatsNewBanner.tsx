import React, { memo, useCallback } from 'react';
import { WHATS_NEW_ITEMS } from '../../content/helpTopics';
import { helpDiscoveryStore, useHelpDiscoveryStore } from '../../stores/helpDiscoveryStore';
import { HelpIconButton } from './HelpTip';

export const WhatsNewBanner = memo(() => {
  useHelpDiscoveryStore(); // re-render on dismiss
  const show = helpDiscoveryStore.shouldShowWhatsNew();

  const dismiss = useCallback(() => {
    helpDiscoveryStore.dismissWhatsNew();
  }, []);

  const openTopic = useCallback((topicId: string) => {
    helpDiscoveryStore.openHelp({ tab: 'guides', topicId });
  }, []);

  if (!show) return null;

  return (
    <aside
      className="mx-2 sm:mx-auto max-w-[1000px] mb-2 rounded-lg border border-cyan-900/40 bg-gradient-to-r from-cyan-950/30 via-zinc-950/80 to-purple-950/20 shadow-hyphon-panel motion-safe:animate-[fadeIn_0.4s_ease-out]"
      role="region"
      aria-label="What's new in Hyphon"
    >
      <div className="flex items-start justify-between gap-3 p-3 sm:p-4">
        <div className="min-w-0 flex-1">
          <h2 className="font-orbitron text-xs sm:text-sm font-bold text-cyan-400 tracking-wider mb-1">
            WHAT&apos;S NEW
          </h2>
          <p className="text-[10px] sm:text-xs text-gray-400 mb-3">
            Quick paths to recently added workflows. Dismiss anytime — open Help (<kbd className="px-1 py-0.5 rounded bg-zinc-900 border border-zinc-700 text-cyan-500 text-[9px]">?</kbd>) later.
          </p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {WHATS_NEW_ITEMS.map((item) => (
              <li key={item.id}>
                <div
                  className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md text-[10px] sm:text-xs text-gray-300 hover:bg-cyan-950/40 hover:text-cyan-200 border border-transparent hover:border-cyan-900/40 "
                >
                  <button type="button" onClick={() => openTopic(item.id)} className="flex-1 text-left flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 rounded">
                  <span className="text-cyan-500" aria-hidden="true">→</span>
                  {item.label}
                  </button>
                  <HelpIconButton topicId={item.id} className="ml-auto shrink-0" />
                </div>
              </li>
            ))}
          </ul>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 text-gray-500 hover:text-white text-sm px-2 py-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
          aria-label="Dismiss what's new banner"
        >
          ✕
        </button>
      </div>
    </aside>
  );
});

WhatsNewBanner.displayName = 'WhatsNewBanner';
