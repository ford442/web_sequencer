import { createRoot, type Root } from 'react-dom/client';
import type { WamHost } from '../audio/wam/WamHost';
import { WAM2_EDITOR_PANEL_ID, Wam2EditorPanel } from './Wam2EditorPanel';

/**
 * Mounts the WAM2 editor panel. The Engine HUD is plain DOM, so the panel owns
 * its own React root under document.body.
 */

let root: Root | null = null;

export function closeWam2Editor(): void {
  root?.unmount();
  root = null;
  document.getElementById(WAM2_EDITOR_PANEL_ID)?.remove();
}

/** Shows the editor for `slotId`, replacing any slot already open. */
export function openWam2Editor(host: WamHost, slotId: string): void {
  let container = document.getElementById(WAM2_EDITOR_PANEL_ID);
  if (!container) {
    container = document.createElement('div');
    container.id = WAM2_EDITOR_PANEL_ID;
    document.body.appendChild(container);
  }
  root ??= createRoot(container);
  // A fresh key per slot so the editor's local state never leaks between slots.
  root.render(<Wam2EditorPanel key={slotId} host={host} slotId={slotId} onClose={closeWam2Editor} />);
}
