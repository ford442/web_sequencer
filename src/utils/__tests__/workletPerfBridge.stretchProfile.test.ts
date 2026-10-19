import { describe, it, expect, vi, beforeEach } from 'vitest';
import { performanceBudget } from '@/utils/performanceBudget';
import { noteBankStretchProfile, registerRubberbandNode } from '@/utils/workletPerfBridge';

function makeNode() {
  const postMessage = vi.fn();
  return { node: { port: { postMessage } } as unknown as AudioWorkletNode, postMessage };
}

// Private on the class; the tests drive the same path evaluate() takes.
function degrade(): void {
  (performanceBudget as any).applyDegradation('granular-quality', 90);
}
function recover(): void {
  (performanceBudget as any).recoverDegradation('granular-quality', 50);
}

describe('rubberband degrade/recover keeps the bank stretch profile', () => {
  beforeEach(() => performanceBudget.resetForTests());

  it('restores a harmonic bank as harmonic', () => {
    const { node, postMessage } = makeNode();
    const unregister = registerRubberbandNode(node);
    noteBankStretchProfile(node, 'harmonic');

    degrade();
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'setStretchProfile', data: { profile: 'fast' } });
    recover();
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'setStretchProfile', data: { profile: 'harmonic' } });
    unregister();
  });

  it('falls back to vocal when no bank profile was ever sent', () => {
    const { node, postMessage } = makeNode();
    const unregister = registerRubberbandNode(node);

    degrade();
    recover();
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'setStretchProfile', data: { profile: 'vocal' } });
    unregister();
  });
});
