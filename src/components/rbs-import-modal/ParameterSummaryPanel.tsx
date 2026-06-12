import React from 'react';

interface ParameterSummary {
  tb303A: { waveform: string; cutoff: number; resonance: number; decay: number; };
  tb303B: { waveform: string; cutoff: number; resonance: number; decay: number; };
  pcfEnabled: boolean;
  kitType: string;
}

interface ParameterSummaryPanelProps {
  paramSummary: ParameterSummary | null;
}

// ⚡ Bolt: Added React.memo to prevent unnecessary re-renders when parent state changes.
export const ParameterSummaryPanel: React.FC<ParameterSummaryPanelProps> = React.memo(({ paramSummary }) => {
  if (!paramSummary) return null;

  return (
    <div className="p-4 bg-gray-900/50 rounded-lg">
      <h3 className="text-sm font-medium text-gray-300 mb-3">Parameter Summary</h3>
      <div className="grid grid-cols-2 gap-4">
        {/* TB-303 A */}
        <div className="p-3 bg-amber-950/20 border border-amber-900/30 rounded">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-amber-400">TB-303 A</span>
            <span className="text-[10px] text-gray-500">
              {paramSummary.tb303A.waveform === 'saw' ? '🔺' : '⬜'} {paramSummary.tb303A.waveform}
            </span>
          </div>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-500">Cutoff</span>
              <span className="text-gray-300">{paramSummary.tb303A.cutoff}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Resonance</span>
              <span className="text-gray-300">{paramSummary.tb303A.resonance}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Decay</span>
              <span className="text-gray-300">{paramSummary.tb303A.decay}</span>
            </div>
          </div>
        </div>

        {/* TB-303 B */}
        <div className="p-3 bg-amber-950/20 border border-amber-900/30 rounded">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-amber-400">TB-303 B</span>
            <span className="text-[10px] text-gray-500">
              {paramSummary.tb303B.waveform === 'saw' ? '🔺' : '⬜'} {paramSummary.tb303B.waveform}
            </span>
          </div>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-500">Cutoff</span>
              <span className="text-gray-300">{paramSummary.tb303B.cutoff}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Resonance</span>
              <span className="text-gray-300">{paramSummary.tb303B.resonance}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Decay</span>
              <span className="text-gray-300">{paramSummary.tb303B.decay}</span>
            </div>
          </div>
        </div>
      </div>

      {/* PCF Badge */}
      {paramSummary.pcfEnabled && (
        <div className="mt-3 flex items-center gap-2">
          <span className="px-2 py-1 bg-purple-500/20 text-purple-400 text-xs rounded border border-purple-500/30">
            PCF Enabled
          </span>
          <span className="text-xs text-gray-500">
            Drum Kit: {paramSummary.kitType.toUpperCase()}
          </span>
        </div>
      )}
    </div>
  );
});
