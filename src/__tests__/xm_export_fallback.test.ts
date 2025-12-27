import { describe, it, expect } from 'vitest';
import {
    createPattern, noteNameToValue
} from '../utils/xm_save_lib/index';
import type { PartSequence, Pattern } from '../types';

type TrackKey = 'partA' | 'partB' | 'kick' | 'snare' | 'closedHat' | 'openHat' | 'sampler';

describe('XM Export Fallback Pattern', () => {
    it('should correctly identify when to use fallback pattern', () => {
        // Empty song structure
        const songStructure: { [key in TrackKey]: number | null }[] = Array(16).fill(null).map(() => ({
            partA: null, partB: null, kick: null, snare: null, closedHat: null, openHat: null, sampler: null
        }));
        
        // Find last active measure
        let lastActiveMeasure = -1;
        for (let i = songStructure.length - 1; i >= 0; i--) {
            const measure = songStructure[i];
            if (Object.values(measure).some(slot => slot !== null)) {
                lastActiveMeasure = i;
                break;
            }
        }
        
        // Create a current pattern with some notes
        const currentPattern: Pattern = {
            partA: { steps: [{ note: 'C4', velocity: 1 }, null, null, null, { note: 'E4', velocity: 1 }, ...Array(27).fill(null)] },
            partB: { steps: Array(32).fill(null) },
            kick: { steps: [{ note: 'C2', velocity: 1 }, null, null, null, { note: 'C2', velocity: 1 }, ...Array(27).fill(null)] },
            snare: { steps: Array(32).fill(null) },
            closedHat: { steps: Array(32).fill(null) },
            openHat: { steps: Array(32).fill(null) },
            sampler: Array(8).fill({ steps: Array(32).fill(null) }),
        };
        
        // With empty song structure, useFallbackPattern should be truthy (the pattern object)
        const useFallbackPattern = lastActiveMeasure === -1 && currentPattern;
        
        expect(lastActiveMeasure).toBe(-1);
        expect(!!useFallbackPattern).toBe(true);
        console.log('Using fallback pattern:', !!useFallbackPattern);
    });
    
    it('should correctly fill XM pattern from current pattern', () => {
        const trackMap: Record<TrackKey, { inst: number, chan: number }> = {
            'partA': { inst: 1, chan: 0 },
            'partB': { inst: 2, chan: 1 },
            'kick': { inst: 3, chan: 2 },
            'snare': { inst: 4, chan: 3 },
            'closedHat': { inst: 5, chan: 4 },
            'openHat': { inst: 6, chan: 5 },
            'sampler': { inst: 7, chan: 6 }
        };
        
        // Create a current pattern with some notes
        const currentPattern: Pattern = {
            partA: { steps: [{ note: 'C4', velocity: 1 }, null, null, null, { note: 'E4', velocity: 1 }, ...Array(27).fill(null)] },
            partB: { steps: Array(32).fill(null) },
            kick: { steps: [{ note: 'C2', velocity: 1 }, null, null, null, { note: 'C2', velocity: 1 }, ...Array(27).fill(null)] },
            snare: { steps: Array(32).fill(null) },
            closedHat: { steps: Array(32).fill(null) },
            openHat: { steps: Array(32).fill(null) },
            sampler: Array(8).fill({ steps: Array(32).fill(null) }),
        };
        
        // Create XM pattern
        const xmPat = createPattern(32, 14);
        
        // Fill from current pattern (simulating the fix logic)
        const fillPatternFromSequence = (sequence: PartSequence, trackKey: TrackKey, bankIdx: number = 0) => {
            let inst, chan;

            if (trackKey === 'sampler') {
                inst = 7 + bankIdx;   // Instruments 7-14
                chan = 6 + bankIdx;   // Channels 6-13
            } else {
                inst = trackMap[trackKey].inst;
                chan = trackMap[trackKey].chan;
            }
            
            sequence.steps.forEach((stepData, row) => {
                if (stepData && row < 32) {
                    const note = xmPat.data[row][chan];

                    if (trackKey.startsWith('part') || trackKey === 'sampler') {
                        const nVal = noteNameToValue(stepData.note);
                        note.note = nVal;
                    } else {
                        note.note = 49; // C-4
                    }

                    note.instrument = inst;
                    note.volume = 64;
                }
            });
        };
        
        (Object.keys(trackMap) as TrackKey[]).forEach(trackKey => {
            if (trackKey === 'sampler') {
                currentPattern.sampler.forEach((seq, idx) => {
                    fillPatternFromSequence(seq, 'sampler', idx);
                });
            } else {
                const sequence = currentPattern[trackKey] as PartSequence;
                if (sequence) {
                    fillPatternFromSequence(sequence, trackKey);
                }
            }
        });
        
        // Verify partA notes were added
        expect(xmPat.data[0][0].note).toBe(49); // C4 = 49
        expect(xmPat.data[0][0].instrument).toBe(1);
        expect(xmPat.data[0][0].volume).toBe(64);
        
        expect(xmPat.data[4][0].note).toBe(53); // E4 = 53
        expect(xmPat.data[4][0].instrument).toBe(1);
        
        // Verify kick notes were added
        expect(xmPat.data[0][2].note).toBe(49); // Drums use C-4
        expect(xmPat.data[0][2].instrument).toBe(3); // Kick instrument
        
        console.log('Pattern data at [0][0] (partA):', JSON.stringify(xmPat.data[0][0]));
        console.log('Pattern data at [0][2] (kick):', JSON.stringify(xmPat.data[0][2]));
    });
    
    it('should NOT use fallback when song structure has data', () => {
        // Song structure with some data
        const songStructure: { [key in TrackKey]: number | null }[] = Array(16).fill(null).map(() => ({
            partA: null, partB: null, kick: null, snare: null, closedHat: null, openHat: null, sampler: null
        }));
        
        // Set slot 0 for partA on measure 0
        songStructure[0].partA = 0;
        
        // Find last active measure
        let lastActiveMeasure = -1;
        for (let i = songStructure.length - 1; i >= 0; i--) {
            const measure = songStructure[i];
            if (Object.values(measure).some(slot => slot !== null)) {
                lastActiveMeasure = i;
                break;
            }
        }
        
        const currentPattern: Pattern = {
            partA: { steps: Array(32).fill({ note: 'C4', velocity: 1 }) },
            partB: { steps: Array(32).fill(null) },
            kick: { steps: Array(32).fill(null) },
            snare: { steps: Array(32).fill(null) },
            closedHat: { steps: Array(32).fill(null) },
            openHat: { steps: Array(32).fill(null) },
            sampler: Array(8).fill({ steps: Array(32).fill(null) }),
        };
        
        const useFallbackPattern = lastActiveMeasure === -1 && currentPattern;
        
        expect(useFallbackPattern).toBe(false);
        expect(lastActiveMeasure).toBe(0);
        console.log('Using fallback pattern:', useFallbackPattern);
        console.log('Last active measure:', lastActiveMeasure);
    });
});
