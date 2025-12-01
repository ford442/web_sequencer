import { describe, it, expect } from 'vitest';
import {
    createModule, createPattern, createInstrument, createSample, addSampleToInstrument,
    XMWriter, noteNameToValue
} from '../utils/xm_save_lib/index';
import type { PartSequence } from '../types';

type TrackKey = 'partA' | 'partB' | 'kick' | 'snare' | 'closedHat' | 'openHat' | 'sampler';

describe('XM Export Issue Analysis', () => {
    it('should demonstrate the empty song structure issue', () => {
        // Simulate the initial state - empty songStructure
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
        
        const activeLength = Math.max(1, lastActiveMeasure + 1);
        
        console.log('lastActiveMeasure:', lastActiveMeasure);
        console.log('activeLength:', activeLength);
        
        // This is the problem - with empty songStructure, nothing gets exported
        expect(lastActiveMeasure).toBe(-1);
        expect(activeLength).toBe(1);
        
        // When activeLength is 1, we loop once with measure at index 0
        const measure = songStructure[0];
        
        // All slots are null, so no pattern data is added
        const allSlotsNull = Object.values(measure).every(slot => slot === null);
        console.log('All slots null:', allSlotsNull);
        expect(allSlotsNull).toBe(true);
    });
    
    it('should show that trackStorage is separate from current pattern', () => {
        // The trackStorage is what the song mode references
        // But users might not save their patterns to trackStorage slots
        const trackStorage: Record<TrackKey, (PartSequence | null)[]> = {
            partA: Array(8).fill(null),
            partB: Array(8).fill(null),
            kick: Array(8).fill(null),
            snare: Array(8).fill(null),
            closedHat: Array(8).fill(null),
            openHat: Array(8).fill(null),
            sampler: Array(8).fill(null),
        };
        
        // The user might be editing patterns directly without saving to storage
        // When they export, the current pattern isn't used unless saved to trackStorage
        // AND referenced in songStructure
        
        console.log('trackStorage partA:', trackStorage.partA);
        
        // All slots are null initially
        const allNull = trackStorage.partA.every(s => s === null);
        expect(allNull).toBe(true);
    });
});
