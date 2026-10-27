import React from 'react';
import type { WamHost } from '../audio/wam/WamHost';
import { Wam2GenericEditor } from './Wam2GenericEditor';

/**
 * Floating panel that hosts the descriptor-driven WAM2 editor for one slot
 * (docs/adr/0001-wam2-host.md#generic-editor). Opened from the Engine HUD's
 * per-slot "Edit" button through openWam2Editor().
 */

export const WAM2_EDITOR_PANEL_ID = 'wam2-editor-panel-root';

interface Wam2EditorPanelProps {
  host: WamHost;
  slotId: string;
  onClose: () => void;
}

export const Wam2EditorPanel: React.FC<Wam2EditorPanelProps> = ({ host, slotId, onClose }) => {
  const descriptor = host.getSlotDescriptor(slotId);
  const closeRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby={`${WAM2_EDITOR_PANEL_ID}-title`}
      className="fixed right-[404px] top-3 z-[99999] flex max-h-[70vh] w-80 flex-col gap-2 overflow-auto rounded-lg border border-gray-700 bg-zinc-900/95 p-3 text-gray-100 shadow-xl"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id={`${WAM2_EDITOR_PANEL_ID}-title`} className="text-xs font-bold">
          WAM2 slot {slotId}
        </h2>
        <button
          ref={closeRef}
          type="button"
          aria-label="Close WAM2 editor"
          className="rounded border border-gray-700 px-2 py-0.5 text-xs hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
          onClick={onClose}
        >
          Close
        </button>
      </div>
      {descriptor ? (
        <Wam2GenericEditor host={host} slotId={slotId} descriptor={descriptor} />
      ) : (
        <p role="status" className="text-xs text-gray-400">
          Slot {slotId} is not mounted.
        </p>
      )}
    </div>
  );
};
