import React from 'react';
import { SAMPLE_BANKS } from './types';

interface SamplerBankTabsProps {
  activeBankIdx: number;
  flashBankIdx: number | null;
  loadedBanks?: boolean[];
  multisampleReady?: boolean[];
  multisampleProcessing?: boolean[];
  tabRefs: React.MutableRefObject<(HTMLButtonElement | null)[]>;
  onBankChange: (i: number) => void;
  onKeyDown: (e: React.KeyboardEvent, index: number) => void;
  status: string;
}

export const SamplerBankTabs = React.memo(function SamplerBankTabs({
  activeBankIdx,
  flashBankIdx,
  loadedBanks,
  multisampleReady,
  multisampleProcessing,
  tabRefs,
  onBankChange,
  onKeyDown,
  status,
}: SamplerBankTabsProps) {
  return (
    <div className="flex-none flex items-center justify-between p-2 border-b border-[#2a2d36] bg-[#141619]">
      <div className="flex gap-1 overflow-x-auto scrollbar-none touch-pan-x" role="tablist" aria-label="Sample Banks">
        {SAMPLE_BANKS.map((label, i) => (
          <button type="button"
            key={i}
            ref={(el) => { tabRefs.current[i] = el; }}
            id={`sampler-bank-tab-${i}`}
            role="tab"
            aria-selected={activeBankIdx === i}
            aria-controls="sampler-bank-panel"
            aria-label={`Select Bank ${i + 1}${loadedBanks?.[i] ? ' (Loaded)' : ''}`}
            tabIndex={activeBankIdx === i ? 0 : -1}
            onClick={() => onBankChange(i)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`relative min-w-[36px] min-h-[44px] py-2 px-2 text-[11px] font-bold border rounded transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 touch-manipulation select-none ${
              flashBankIdx === i ? 'bg-green-600 border-green-400 text-white animate-pulse' :
              activeBankIdx === i
                ? 'bg-purple-600 border-purple-400 text-white shadow-md'
                : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'
            }`}
            title={`Select Bank ${i + 1}${multisampleReady?.[i] ? ' (Multisample Ready)' : loadedBanks?.[i] ? ' (Loaded)' : ''}`}
            style={{ touchAction: 'manipulation' }}
          >
            {label}
            <div className="absolute -top-0.5 -right-0.5 flex">
              {multisampleProcessing?.[i] && (
                <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse border border-black"
                     title="Processing multisamples..." />
              )}
              {!multisampleProcessing?.[i] && multisampleReady?.[i] && (
                <div className="w-2 h-2 bg-cyan-500 rounded-full shadow-[0_0_4px_rgba(6,182,212,0.8)] border border-black"
                     title="Multisample ready" />
              )}
              {!multisampleReady?.[i] && loadedBanks?.[i] && (
                <div className="w-1.5 h-1.5 bg-green-500 rounded-full shadow-[0_0_4px_rgba(34,197,94,0.8)] border border-black"
                     title="Sample loaded" />
              )}
            </div>
          </button>
        ))}
      </div>

      <div
        className="text-[10px] text-right truncate w-24 text-yellow-500 ml-2"
        title={status}
        role="status"
        aria-live="polite"
      >
        {status}
      </div>
    </div>
  );
});
