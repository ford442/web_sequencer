import React from 'react';
import type { AISongData } from '../../importers/ai-song';
import { useAISongAudioPreview } from './useAISongAudioPreview';
import type { AISongPreviewSlot } from '../../utils/aiSongPreview';
import type { OfflineGraphSlotReport } from '../../audio/offline/compileOfflineGraph';

interface AudioPreviewPanelProps {
  parsedData: AISongData;
  /** `AudioContext.sampleRate` of the running engine, or null when idle. */
  liveSampleRate: number | null;
  onShowToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const SKIP_LABELS: Record<NonNullable<AISongPreviewSlot['reason']>, string> = {
  'no-notes': 'no notes',
  'tts-not-rendered': 'TTS runs on import',
  'sample-not-loaded': 'sample loads on import',
  'render-failed': 'render failed',
};

const WAM_SKIP_LABELS: Record<NonNullable<OfflineGraphSlotReport['reason']>, string> = {
  'offline-unsupported': 'no offline render (WAM2)',
  'not-allowlisted': 'not in the WAM2 allowlist',
  'catalog-unavailable': 'WAM2 catalog unavailable',
  'mount-failed': 'failed to load offline',
  'no-plugin-in-slot': 'empty slot',
};

function Badge({ tone, children }: { tone: 'amber' | 'gray'; children: React.ReactNode }) {
  const className =
    tone === 'amber'
      ? 'bg-amber-500/10 text-amber-300 border-amber-600/40'
      : 'bg-gray-800 text-gray-400 border-gray-700';
  return (
    <span className={`px-1.5 py-0.5 rounded border text-[10px] ${className}`}>{children}</span>
  );
}

/**
 * Audible preview of the pasted song (#1233).
 *
 * The audio comes from the same offline patch-bay compiler freeze and stem
 * export use, so this is a preview of the bounce rather than of a second
 * engine. Anything the preview cannot produce — a TTS bank, a WAM2 insert with
 * no offline support — is listed here rather than silently dropped.
 */
export const AudioPreviewPanel = React.memo(function AudioPreviewPanel({
  parsedData,
  liveSampleRate,
  onShowToast,
}: AudioPreviewPanelProps) {
  const preview = useAISongAudioPreview(parsedData, { liveSampleRate });
  const isRendering = preview.status === 'rendering';

  const handleRender = React.useCallback(() => {
    void preview.render();
  }, [preview]);

  React.useEffect(() => {
    if (preview.status === 'error' && preview.error) {
      onShowToast(`Preview failed: ${preview.error}`, 'error');
    }
  }, [preview.status, preview.error, onShowToast]);

  const skipped = preview.result?.slots.filter((slot) => slot.status !== 'rendered') ?? [];
  const bypassed = preview.result?.graph.slots.filter((slot) => slot.status === 'bypassed') ?? [];

  return (
    <div className="p-4 bg-gray-900/50 rounded-lg">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-medium text-gray-300">Audio Preview</h3>
          <p className="text-xs text-gray-500">
            Renders the first bars through the live patch bay — the same graph an export bounces.
          </p>
        </div>
        <button
          type="button"
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f1115]"
          onClick={handleRender}
          disabled={isRendering}
          aria-label={isRendering ? 'Rendering preview' : 'Render preview'}
        >
          <span aria-hidden="true">{isRendering ? '…' : '▶'}</span>
          {isRendering ? 'Rendering…' : preview.url ? 'Re-render' : 'Render Preview'}
        </button>
      </div>

      {preview.url && preview.result && (
        <div className="mt-3 space-y-2">
          {/* Generated audio: there is no caption track to offer. */}
          <audio
            src={preview.url}
            controls
            className="w-full"
            aria-label={`Preview of ${parsedData.meta.title}`}
          />
          <p className="text-[10px] text-gray-500 font-mono">
            {preview.result.bars} bars · {preview.result.tempo} BPM ·{' '}
            {preview.result.sampleRate} Hz · patch “{preview.result.graph.patchName}”
          </p>
        </div>
      )}

      {preview.status === 'error' && preview.error && (
        <p role="alert" className="mt-3 text-xs text-red-400">
          {preview.error}
        </p>
      )}

      {preview.result && (skipped.length > 0 || bypassed.length > 0) && (
        <div className="mt-3 space-y-1">
          <p className="text-[10px] uppercase tracking-wide text-gray-500">
            Not in this preview{preview.skipSummary ? ` — ${preview.skipSummary}` : ''}
          </p>
          <ul className="space-y-1">
            {skipped.map((slot) => (
              <li key={slot.slot} className="flex items-center gap-2 text-[11px] text-gray-400">
                <span className="w-28 shrink-0 text-gray-500">{slot.slot}</span>
                <Badge tone={slot.status === 'skipped' ? 'amber' : 'gray'}>
                  {slot.reason ? SKIP_LABELS[slot.reason] : slot.status}
                </Badge>
                {slot.detail && <span className="truncate">{slot.detail}</span>}
              </li>
            ))}
            {bypassed.map((slot) => (
              <li key={slot.nodeId} className="flex items-center gap-2 text-[11px] text-gray-400">
                <span className="w-28 shrink-0 text-gray-500">
                  {slot.packageId ?? slot.nodeId}
                </span>
                <Badge tone="amber">
                  {slot.reason ? WAM_SKIP_LABELS[slot.reason] : 'bypassed'}
                </Badge>
                {slot.detail && <span className="truncate">{slot.detail}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
});
