import { TRACK_COLORS } from '../components/sequencer/constants';
import { expressionLedStore } from '../stores/expressionLedStore';
import type { ExpressionLedTarget } from '../types';
import { getNoteColor } from '../utils/noteColors';

const TARGET_TRACK_KEY: Partial<Record<ExpressionLedTarget, 'partA' | 'partB' | 'bass2'>> = {
    synthA: 'partA',
    synthB: 'partB',
    bass2: 'bass2',
};

const TARGET_FALLBACK: Record<ExpressionLedTarget, string> = {
    synthA: TRACK_COLORS.partA,
    synthB: TRACK_COLORS.partB,
    bass2: TRACK_COLORS.partB,
    kick: TRACK_COLORS.kick,
    snare: TRACK_COLORS.snare,
    closedHat: TRACK_COLORS.closedHat,
    openHat: TRACK_COLORS.openHat,
    sampler: TRACK_COLORS.sampler,
};

/** Bump the expression LED for an instrument with optional note-colored hue. */
export function pulseExpressionLed(
    target: ExpressionLedTarget,
    note?: string,
    envelope = 1,
): void {
    const trackKey = TARGET_TRACK_KEY[target];
    const color = note
        ? getNoteColor(note, trackKey)
        : TARGET_FALLBACK[target];
    expressionLedStore.pulse(target, color, envelope);
}
