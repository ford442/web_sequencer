/**
 * Engine HUD: the audio input picker (#1498 P1), beside the output picker.
 *
 * "List inputs" opens the chosen input with the recording constraints (echo
 * cancellation, noise suppression and auto gain off), reads back
 * `track.getSettings()` — what the browser actually kept — and closes it.
 * The choice is stored by group and label (`audioInputDevice.ts`); takes open
 * it themselves.
 */

import { recordingSupport } from '../audio/recording/recordingSupport';

/** The input code loads on the first click: the HUD is in the entry chunk. */
const loadInput = () => import('../utils/audioInputDevice');

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export interface HudInputSection {
    html(): string;
    /** Handles a click on one of its controls; false when the target is not its own. */
    onClick(target: HTMLElement): boolean;
    onChange(target: HTMLElement): boolean;
}

export function createHudInputSection(rerender: () => void): HudInputSection {
    let devices: MediaDeviceInfo[] = [];
    let selected = '';
    let settingsLine: string | null = null;
    let warning: string | null = null;
    let error: string | null = null;

    /** Open `deviceId` (or the stored choice) with the take constraints and report what it runs with. */
    async function probe(deviceId?: string): Promise<void> {
        const { describeInputSettings, openRecordingInput } = await loadInput();
        const input = await openRecordingInput(deviceId);
        try {
            settingsLine = `${input.label}: ${describeInputSettings(input.settings)}`;
            const notes: string[] = [];
            if (input.keptProcessing.length) notes.push(`the browser kept ${input.keptProcessing.join(', ')} on`);
            if (input.fellBackToDefault) notes.push('the stored input is gone; the default opened');
            warning = notes.length ? notes.join('; ') : null;
            selected = input.deviceId;
        } finally {
            input.close();
        }
    }

    return {
        html() {
            const support = recordingSupport();
            if (!support.ok) {
                return `<div class="subheader">Audio input</div>
      <div style="font-size:10px;color:#f87171">Recording unsupported: ${escapeHtml(support.reason)}</div>`;
            }
            const options = devices.map((d) =>
                `<option value="${escapeHtml(d.deviceId)}"${d.deviceId === selected ? ' selected' : ''}>${escapeHtml(d.label || d.deviceId)}</option>`).join('');
            return `<div class="subheader">Audio input</div>
      <div class="row" style="gap:4px;flex-wrap:wrap">
        <button type="button" id="hud-input-grant" aria-label="List audio input devices">List inputs</button>
        <select id="hud-input-select" aria-label="Audio input device" style="flex:1;min-width:140px;background:#111;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:11px">
          <option value=""${selected === '' ? ' selected' : ''}>Default input</option>
          ${options}
        </select>
      </div>${settingsLine ? `
      <div data-testid="hud-input-settings" style="font-size:10px;opacity:0.8">${escapeHtml(settingsLine)}</div>` : ''}${warning ? `
      <div style="font-size:10px;color:#fbbf24">${escapeHtml(warning)}</div>` : ''}${error ? `
      <div style="font-size:10px;color:#f87171">${escapeHtml(error)}</div>` : ''}`;
        },

        onClick(target) {
            if (target.id !== 'hud-input-grant') return false;
            void (async () => {
                try {
                    // Opening the input grants the labels enumerateDevices needs.
                    const { getStoredAudioInput, listAudioInputDevices, matchStoredInput } = await loadInput();
                    await probe();
                    devices = await listAudioInputDevices();
                    const stored = matchStoredInput(devices, getStoredAudioInput());
                    if (stored) selected = stored.deviceId;
                    error = null;
                } catch (err) {
                    error = err instanceof Error ? err.message : 'Could not list audio inputs';
                }
                rerender();
            })();
            return true;
        },

        onChange(target) {
            if (target.id !== 'hud-input-select') return false;
            const deviceId = (target as HTMLSelectElement).value;
            const device = devices.find((d) => d.deviceId === deviceId);
            void (async () => {
                try {
                    (await loadInput()).setStoredAudioInput(device ? { groupId: device.groupId, label: device.label, deviceId: device.deviceId } : null);
                    await probe(deviceId || undefined);
                    error = null;
                } catch (err) {
                    error = err instanceof Error ? err.message : 'Could not open the input';
                }
                rerender();
            })();
            return true;
        },
    };
}
