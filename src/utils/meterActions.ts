import { transportMixStore } from '@/stores/transportMixStore';
import { stepLengthPreset } from '@/utils/songMeter';

/** Step the song pattern length one preset up/down (transport LEN buttons, Shift + [ / ], gamepad LT / RT). */
export function nudgePatternLength(direction: 1 | -1): void {
    const { stepCount, timeSignature } = transportMixStore.getSnapshot();
    transportMixStore.setStepCount(stepLengthPreset(stepCount, direction, timeSignature));
}
