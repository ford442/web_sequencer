import { describe, it, expect, vi } from 'vitest';
import { createStopAllNotes } from '../audioPlayback/noteControls';
import { DrumKitEngine } from '../../../engines/DrumKitEngine';

/**
 * #1344 P5: the clock posts steps STEP_LOOKAHEAD_MS early, so at STOP the
 * notes and hits due just after it are already queued in the voice worklets.
 * Transport stop has to cancel those, not only release what is sounding.
 */

const ref = <T,>(current: T) => ({ current });

describe('stopAllNotes with steps posted ahead', () => {
  it('releases the 303s and cancels what Prophecy and the drum kit still hold', () => {
    const open303 = { allNotesOffBass1: vi.fn(), allNotesOffBass2: vi.fn(), allNotesOffLead303: vi.fn() };
    const prophecy = { allNotesOff: vi.fn() };
    const drums = { cancelPending: vi.fn() };
    const stop = createStopAllNotes({
      activeSynthNotes: ref(new Map()),
      activeSamplerNotes: ref(new Map()),
      voiceManagerARef: ref(null),
      voiceManagerBRef: ref(null),
      singingVoiceManagerRef: ref(null),
      open303ManagerRef: ref(open303),
      prophecyManagerRef: ref(prophecy),
      drumKitEngineRef: ref(drums),
    } as never);

    stop();

    expect(open303.allNotesOffBass1).toHaveBeenCalledOnce();
    expect(open303.allNotesOffBass2).toHaveBeenCalledOnce();
    expect(open303.allNotesOffLead303).toHaveBeenCalledOnce();
    expect(prophecy.allNotesOff).toHaveBeenCalledOnce();
    expect(drums.cancelPending).toHaveBeenCalledOnce();
  });

  it('DrumKitEngine.cancelPending tells a live worklet to drop its pending hits', () => {
    const engine = new DrumKitEngine('808');
    const postMessage = vi.fn();
    engine.cancelPending(); // no worklet yet — nothing to do, no throw
    const internals = engine as unknown as { wasmReady: boolean; workletNode: { port: { postMessage: typeof postMessage } } };
    internals.wasmReady = true;
    internals.workletNode = { port: { postMessage } };
    engine.cancelPending();
    expect(postMessage).toHaveBeenCalledWith({ type: 'allNotesOff' });
  });
});
