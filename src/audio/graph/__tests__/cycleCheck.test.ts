import { describe, expect, it } from 'vitest';
import { CLASSIC_ELECTRIBE_GRAPH } from '../defaultElectribeGraph';
import { assertSafeGraphCycles, GraphCycleError } from '../cycleCheck';
import type { AudioGraphConfig } from '../types';

describe('assertSafeGraphCycles', () => {
  it('allows the classic delay feedback loop', () => {
    expect(() => assertSafeGraphCycles(CLASSIC_ELECTRIBE_GRAPH)).not.toThrow();
  });

  it('rejects a gain-only cycle', () => {
    const cyclic: AudioGraphConfig = {
      id: 'bad',
      name: 'bad',
      nodes: [
        { id: 'a', factory: 'gain' },
        { id: 'b', factory: 'gain' },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
    };
    expect(() => assertSafeGraphCycles(cyclic)).toThrow(GraphCycleError);
  });
});
