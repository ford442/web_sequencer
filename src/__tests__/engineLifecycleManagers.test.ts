import { describe, it, expect, vi } from 'vitest';
import { ProphecyManager } from '../engines/ProphecyManager';
import { DrumKitEngine } from '../engines/DrumKitEngine';

describe('ProphecyManager', () => {
  it('connectBuses routes partA and partB to separate destinations', () => {
    const manager = new ProphecyManager();
    const partA = { connect: vi.fn(), isReady: true } as unknown as import('../engines/ProphecyOscillator').ProphecyOscillator;
    const partB = { connect: vi.fn(), isReady: true } as unknown as import('../engines/ProphecyOscillator').ProphecyOscillator;

    (manager as unknown as { partA: typeof partA; partB: typeof partB }).partA = partA;
    (manager as unknown as { partA: typeof partA; partB: typeof partB }).partB = partB;

    const destA = { connect: vi.fn() } as unknown as AudioNode;
    const destB = { connect: vi.fn() } as unknown as AudioNode;

    manager.connectBuses(destA, destB);

    expect(partA.connect).toHaveBeenCalledWith(destA);
    expect(partB.connect).toHaveBeenCalledWith(destB);
  });
});

describe('DrumKitEngine', () => {
  it('setKit switches synthesis character between 808 and 909', () => {
    const engine = new DrumKitEngine('808');
    expect(engine.kitType).toBe('808');
    engine.setKit('909');
    expect(engine.kitType).toBe('909');
  });
});
