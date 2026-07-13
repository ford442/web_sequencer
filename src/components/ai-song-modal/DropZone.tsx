import React from 'react';
import type { DroppedFile } from '../../types/aiSongModal';
import { formatFileSize, getFileIcon } from '../../utils/aiSongUtils';
import { Tooltip } from './Tooltip';

interface DropZoneProps {
  isDragging: boolean;
  droppedFiles: DroppedFile[];
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveFile: (id: string) => void;
}

export const DropZone = React.memo(function DropZone({
  isDragging,
  droppedFiles,
  fileInputRef,
  onFileSelect,
  onRemoveFile,
}: DropZoneProps) {
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); }}
      className={`border-2 border-dashed rounded-lg p-4 sm:p-6 text-center transition-all duration-300 ${
        isDragging
          ? 'border-emerald-500 bg-emerald-500/10 scale-[1.02] shadow-[0_0_30px_rgba(16,185,129,0.3)]'
          : 'border-gray-700 bg-gray-900/50 hover:border-gray-600'
      }`}
    >
      <div className={`text-3xl mb-2 transition-transform duration-300 ${isDragging ? 'scale-125 animate-bounce' : ''}`}>
        {isDragging ? '📥' : '📁'}
      </div>
      <p className={`text-sm font-medium transition-all duration-300 ${isDragging ? 'text-emerald-400' : 'text-gray-400'}`}>
        {isDragging ? 'Drop to import' : 'Drag & drop .json files here'}
      </p>
      <p className="text-xs text-gray-500 mt-1">
        {isDragging ? 'Release to load' : 'Supports multiple files'}
      </p>
      <p className="text-xs text-gray-600 my-2">or</p>
      <Tooltip text="Select one or more .json files" position="bottom">
        <button type="button"
          onClick={() => fileInputRef.current?.click()}
          className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f1115]"
        >
          Browse Files
        </button>
      </Tooltip>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        onChange={onFileSelect}
        multiple
        className="hidden"
        aria-label="Upload JSON file"
      />

      {droppedFiles.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-xs text-gray-500 text-left">Selected files:</p>
          {droppedFiles.map((droppedFile, index) => (
            <div
              key={droppedFile.id}
              className={`flex items-center justify-between p-2 rounded-lg text-xs ${
                index === 0 ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-gray-800/50'
              }`}
            >
              <div className="flex items-center gap-2 overflow-hidden">
                <span>{getFileIcon(droppedFile.file.name)}</span>
                <span className="text-gray-300 truncate">{droppedFile.file.name}</span>
                <span className="text-gray-500 shrink-0">({formatFileSize(droppedFile.file.size)})</span>
                {index === 0 && <span className="text-emerald-400 text-[10px]">(active)</span>}
              </div>
              <Tooltip text="Remove file" position="left">
                <button type="button"
                  onClick={() => onRemoveFile(droppedFile.id)}
                  className="w-6 h-6 rounded hover:bg-red-500/20 text-gray-500 hover:text-red-400 transition-all shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f1115]"
                  aria-label={`Remove ${droppedFile.file.name}`}
                ><span aria-hidden="true">✕</span></button>
              </Tooltip>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
