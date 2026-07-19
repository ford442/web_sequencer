import React from 'react';
import { PROMPT_TEMPLATE } from '../../constants/aiSongExamples';
import { Tooltip } from './Tooltip';

interface TemplateTabPanelProps {
  onCopyTemplate: () => void;
}

export const TemplateTabPanel = React.memo(function TemplateTabPanel({
  onCopyTemplate,
}: TemplateTabPanelProps) {
  return (
    <div id="ai-modal-panel-template" role="tabpanel" aria-labelledby="ai-modal-tab-template" className="space-y-4">
      <div className="p-4 bg-gray-900/50 rounded-lg">
        <p className="text-sm text-gray-300 mb-4">
          Copy this prompt template and paste it into your AI assistant (Claude, Gemini, Jules, Copilot, etc.).
          Customize the genre, tempo, and mood as desired.
        </p>
        <Tooltip text="Copy to clipboard" position="right">
          <button type="button"
            onClick={onCopyTemplate}
            className="mb-3 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded transition-all flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f1115]"
            aria-label="Copy AI Prompt Template"
          >
            <span>📋</span> Copy Template
          </button>
        </Tooltip>
        <pre className="bg-[#0a0c10] border border-gray-800 rounded-lg p-4 text-xs text-gray-400 overflow-x-auto whitespace-pre-wrap font-mono">
          {PROMPT_TEMPLATE}
        </pre>
      </div>

      <div className="p-4 bg-blue-950/20 border border-blue-900/30 rounded-lg">
        <h3 className="text-sm font-medium text-blue-400 mb-2">🎯 Tips for Best Results</h3>
        <ul className="text-xs text-blue-400/70 space-y-1 list-disc list-inside">
          <li>Be specific about genre (techno, house, drum & bass, etc.)</li>
          <li>Mention desired energy level (chill, driving, aggressive)</li>
          <li>Reference specific artists or tracks for style</li>
          <li>Specify complexity (minimal, layered, complex)</li>
          <li>Most AIs work best with clear, structured prompts</li>
        </ul>
      </div>
    </div>
  );
});
