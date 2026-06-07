import React from 'react';
import type { RbsImportOptions } from '../../importers/rbs';

interface ImportOptionsPanelProps {
  importOptions: RbsImportOptions;
  updateOption: <K extends keyof RbsImportOptions>(key: K, value: RbsImportOptions[K]) => void;
  showOptions: boolean;
  setShowOptions: (show: boolean) => void;
}

export const ImportOptionsPanel: React.FC<ImportOptionsPanelProps> = ({
  importOptions,
  updateOption,
  showOptions,
  setShowOptions
}) => {
  return (
    <div className="border border-gray-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setShowOptions(!showOptions)}
        aria-expanded={showOptions}
        aria-controls="import-options-panel"
        className="w-full p-3 bg-gray-900/50 flex items-center justify-between hover:bg-gray-800/50 transition-all"
      >
        <span className="text-sm font-medium text-gray-300">Import Options</span>
        <span className="text-gray-500">{showOptions ? '▼' : '▶'}</span>
      </button>

      {showOptions && (
        <div id="import-options-panel" className="p-4 space-y-4 bg-gray-900/30">
          {/* Expand Steps */}
          <div
            className="flex items-center justify-between cursor-pointer"
            onClick={() => updateOption('expandTo32Steps', !importOptions.expandTo32Steps)}
          >
            <span id="expand-label" className="text-sm text-gray-400 select-none">Expand 16 → 32 steps</span>
            <button
              type="button"
              role="switch"
              aria-checked={importOptions.expandTo32Steps}
              aria-labelledby="expand-label"
              onClick={(e) => {
                e.stopPropagation();
                updateOption('expandTo32Steps', !importOptions.expandTo32Steps);
              }}
              className={`relative inline-flex h-4 w-8 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-1 focus-visible:ring-offset-gray-900 ${
                importOptions.expandTo32Steps ? 'bg-amber-600' : 'bg-gray-800'
              }`}
            >
              <span className="sr-only">Expand 16 to 32 steps</span>
              <span
                aria-hidden="true"
                className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  importOptions.expandTo32Steps ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Import Swing */}
          <div
            className="flex items-center justify-between cursor-pointer"
            onClick={() => updateOption('importSwing', !importOptions.importSwing)}
          >
            <span id="swing-label" className="text-sm text-gray-400 select-none">Import swing settings</span>
            <button
              type="button"
              role="switch"
              aria-checked={importOptions.importSwing}
              aria-labelledby="swing-label"
              onClick={(e) => {
                e.stopPropagation();
                updateOption('importSwing', !importOptions.importSwing);
              }}
              className={`relative inline-flex h-4 w-8 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-1 focus-visible:ring-offset-gray-900 ${
                importOptions.importSwing ? 'bg-amber-600' : 'bg-gray-800'
              }`}
            >
              <span className="sr-only">Import swing settings</span>
              <span
                aria-hidden="true"
                className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  importOptions.importSwing ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Convert PCF */}
          <div
            className="flex items-center justify-between cursor-pointer"
            onClick={() => updateOption('convertPcfToAutomation', !importOptions.convertPcfToAutomation)}
          >
            <span id="pcf-label" className="text-sm text-gray-400 select-none">Convert PCF to automation</span>
            <button
              type="button"
              role="switch"
              aria-checked={importOptions.convertPcfToAutomation}
              aria-labelledby="pcf-label"
              onClick={(e) => {
                e.stopPropagation();
                updateOption('convertPcfToAutomation', !importOptions.convertPcfToAutomation);
              }}
              className={`relative inline-flex h-4 w-8 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-1 focus-visible:ring-offset-gray-900 ${
                importOptions.convertPcfToAutomation ? 'bg-amber-600' : 'bg-gray-800'
              }`}
            >
              <span className="sr-only">Convert PCF to automation</span>
              <span
                aria-hidden="true"
                className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  importOptions.convertPcfToAutomation ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Drum Kit */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">Drum kit</span>
            <select
              value={importOptions.drumKitMapping}
              onChange={(e) => updateOption('drumKitMapping', e.target.value as RbsImportOptions['drumKitMapping'])}
              className="bg-gray-800 text-gray-300 text-sm rounded px-2 py-1 border border-gray-700 focus:border-amber-500/50 outline-none"
              aria-label="Drum Kit Mapping"
            >
              <option value="auto">Auto</option>
              <option value="808">808</option>
              <option value="909">909</option>
            </select>
          </div>

          {/* 303 A Target */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">TB-303 A target</span>
            <select
              value={importOptions.tb303ATarget}
              onChange={(e) => updateOption('tb303ATarget', e.target.value as RbsImportOptions['tb303ATarget'])}
              className="bg-gray-800 text-gray-300 text-sm rounded px-2 py-1 border border-gray-700 focus:border-amber-500/50 outline-none"
              aria-label="TB-303 A Target"
            >
              <option value="partA">Part A</option>
              <option value="partB">Part B</option>
              <option value="bass2">Bass 2 (TB-303)</option>
            </select>
          </div>

          {/* 303 B Target */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">TB-303 B target</span>
            <select
              value={importOptions.tb303BTarget}
              onChange={(e) => updateOption('tb303BTarget', e.target.value as RbsImportOptions['tb303BTarget'])}
              className="bg-gray-800 text-gray-300 text-sm rounded px-2 py-1 border border-gray-700 focus:border-amber-500/50 outline-none"
              aria-label="TB-303 B Target"
            >
              <option value="partB">Part B</option>
              <option value="partA">Part A</option>
              <option value="bass2">Bass 2 (TB-303)</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
};
