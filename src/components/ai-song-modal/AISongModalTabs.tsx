import React from 'react';
import type { TabType } from '../../types/aiSongModal';

interface AISongModalTabsProps {
  activeTab: TabType;
  isValid: boolean;
  onTabChange: (tab: TabType) => void;
}

export const AISongModalTabs = React.memo(function AISongModalTabs({
  activeTab,
  isValid,
  onTabChange,
}: AISongModalTabsProps) {
  const TABS: TabType[] = ['paste', 'template', 'preview'];

  const handleTabKeyDown = (e: React.KeyboardEvent) => {
    const currentIndex = TABS.indexOf(activeTab);
    let nextIndex = currentIndex;

    switch (e.key) {
      case 'ArrowRight':
        do {
            nextIndex = (nextIndex + 1) % TABS.length;
        } while (TABS[nextIndex] === 'preview' && !isValid && nextIndex !== currentIndex);
        break;
      case 'ArrowLeft':
        do {
            nextIndex = (nextIndex - 1 + TABS.length) % TABS.length;
        } while (TABS[nextIndex] === 'preview' && !isValid && nextIndex !== currentIndex);
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = isValid ? TABS.length - 1 : TABS.length - 2;
        break;
      default:
        return;
    }

    if (nextIndex === currentIndex) return;
    const nextTab = TABS[nextIndex];

    // Call the tab change immediately. It will trigger a re-render setting focus if we had focus management in here.
    // In React 18, state updates are batched, so we might need a small timeout or useEffect to focus the newly active tab
    // However, typical accessible tabs focus the element directly.
    onTabChange(nextTab);

    // We also need to manually focus the newly selected tab button
    setTimeout(() => {
       const tabElement = document.getElementById(`ai-modal-tab-${nextTab}`);
       if (tabElement) tabElement.focus();
    }, 0);
  };

  return (
    <div className="flex border-b border-gray-800 overflow-x-auto" role="tablist" aria-label="Import method" onKeyDown={handleTabKeyDown}>
      <button type="button"
        id="ai-modal-tab-paste"
        role="tab"
        aria-selected={activeTab === 'paste'}
        aria-controls="ai-modal-panel-paste"
        tabIndex={activeTab === 'paste' ? 0 : -1}
        onClick={() => onTabChange('paste')}
        className={`flex-1 py-2 sm:py-3 text-xs sm:text-sm font-medium transition-all whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-inset ${
          activeTab === 'paste'
            ? 'text-emerald-400 border-b-2 border-emerald-500 bg-emerald-500/5'
            : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
        }`}
      >
        <span className="hidden sm:inline" aria-hidden="true">📋 </span>Paste JSON
      </button>
      <button type="button"
        id="ai-modal-tab-template"
        role="tab"
        aria-selected={activeTab === 'template'}
        aria-controls="ai-modal-panel-template"
        tabIndex={activeTab === 'template' ? 0 : -1}
        onClick={() => onTabChange('template')}
        className={`flex-1 py-2 sm:py-3 text-xs sm:text-sm font-medium transition-all whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-inset ${
          activeTab === 'template'
            ? 'text-emerald-400 border-b-2 border-emerald-500 bg-emerald-500/5'
            : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
        }`}
      >
        <span className="hidden sm:inline">📝 </span>Template
      </button>
      <button type="button"
        id="ai-modal-tab-preview"
        role="tab"
        aria-selected={activeTab === 'preview'}
        aria-controls="ai-modal-panel-preview"
        tabIndex={activeTab === 'preview' ? 0 : -1}
        onClick={() => isValid && onTabChange('preview')}
        disabled={!isValid}
        className={`flex-1 py-2 sm:py-3 text-xs sm:text-sm font-medium transition-all whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-inset ${
          activeTab === 'preview'
            ? 'text-emerald-400 border-b-2 border-emerald-500 bg-emerald-500/5'
            : !isValid
              ? 'text-gray-600 cursor-not-allowed'
              : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
        }`}
      >
        <span className="hidden sm:inline">👁️ </span>Preview
        {!isValid && <span className="text-[10px] opacity-50 ml-1">(needs valid JSON)</span>}
      </button>
    </div>
  );
});
