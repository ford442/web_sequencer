import { describe, expect, it } from 'vitest';
import { getSynthControls } from '@/utils/knobConfigs';
import { DEFAULT_SYNTH_PARAMS_A } from '@/constants';

/**
 * #1395 — the oscillator selector on SYNTH A / B is a right-hand column
 * (`SYNTH_OVERLAY_COLUMN` in useHardwarePanels: 27% wide, right-6, top-4) about
 * 160px tall at the 968x380 desktop rack. Its REC dots and labels sat under
 * it. Fractions below are of that rack: the column starts at x ≈ 0.706 and ends
 * at y ≈ 0.48.
 */
const COLUMN_LEFT = 0.70;
const COLUMN_BOTTOM = 0.49;
const RACK_W = 968;
const RACK_H = 380;
const REC_DOT_RADIUS_Y = 8 / RACK_H;

describe('getSynthControls layout', () => {
    it('keeps every knob, label and REC dot clear of the oscillator selector column', () => {
        for (const waveform of ['sawtooth', 'wav-saw', 'pyodide-saw'] as const) {
            const controls = getSynthControls({ ...DEFAULT_SYNTH_PARAMS_A, waveform });
            for (const c of controls) {
                // Knob radius is size * min(width, height) = size * RACK_H.
                const right = c.x + (c.size * RACK_H) / RACK_W;
                const recTop = c.y - c.size * 1.3 - REC_DOT_RADIUS_Y;
                const intrudesColumn = right > COLUMN_LEFT && recTop < COLUMN_BOTTOM;
                expect(intrudesColumn, `${c.id} (${c.label}) sits under the oscillator selector`).toBe(false);
            }
        }
    });

    it('has no two knobs on the same spot', () => {
        const controls = getSynthControls(DEFAULT_SYNTH_PARAMS_A);
        for (let i = 0; i < controls.length; i++) {
            for (let j = i + 1; j < controls.length; j++) {
                const dx = (controls[i].x - controls[j].x) * RACK_W;
                const dy = (controls[i].y - controls[j].y) * RACK_H;
                const minGap = (controls[i].size + controls[j].size) * RACK_H;
                expect(
                    Math.hypot(dx, dy),
                    `${controls[i].label} overlaps ${controls[j].label}`,
                ).toBeGreaterThanOrEqual(minGap);
            }
        }
    });
});
