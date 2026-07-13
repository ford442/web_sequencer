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
  return (
    <div className="flex border-b border-gray-800 overflow-x-auto" role="tablist" aria-label="Import method">
      <button type="button"
        id="ai-modal-tab-paste"
        role="tab"
        aria-selected={activeTab === 'paste'}
        aria-controls="ai-modal-panel-paste"
        onClick={() => onTabChange('paste')}
        className={`flex-1 py-2 sm:py-3 text-xs sm:text-sm font-medium transition-all whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-inset ${
          activeTab === 'paste'
            ? 'text-emerald-400 border-b-2 border-emerald-500 bg-emerald-500/5'
            : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
        }`}
      >
        <span className="hidden sm:inline">📋 </span>Paste JSON
      </button>
      <button type="button"
        id="ai-modal-tab-template"
        role="tab"
        aria-selected={activeTab === 'template'}
        aria-controls="ai-modal-panel-template"
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
