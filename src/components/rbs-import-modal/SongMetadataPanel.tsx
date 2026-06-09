import React from 'react';

interface SongMetadataPanelProps {
  project: {
    name: string;
    tempo: number;
    timeSignatureNum: number;
    timeSignatureDen: number;
    swing: number;
    patternLength: number;
  };
  version: number | string;
}

export const SongMetadataPanel: React.FC<SongMetadataPanelProps> = ({ project, version }) => {
  return (
    <div className="p-4 bg-amber-950/20 border border-amber-900/30 rounded-lg">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-amber-400">{project.name}</h3>
        <span className="text-xs text-gray-500">RBS {version}</span>
      </div>
      <div className="grid grid-cols-4 gap-4 text-xs">
        <div>
          <span className="text-gray-500 block">Tempo</span>
          <span className="text-white">{project.tempo} BPM</span>
        </div>
        <div>
          <span className="text-gray-500 block">Time Signature</span>
          <span className="text-white">{project.timeSignatureNum}/{project.timeSignatureDen}</span>
        </div>
        <div>
          <span className="text-gray-500 block">Swing</span>
          <span className="text-white">{project.swing}%</span>
        </div>
        <div>
          <span className="text-gray-500 block">Length</span>
          <span className="text-white">{project.patternLength} steps</span>
        </div>
      </div>
    </div>
  );
};
