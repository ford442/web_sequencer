// src/__tests__/FormantShifter.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FormantShifter, VOICE_FORMANTS } from '../engines/rubberband/FormantShifter';

// Mock AudioContext for tests
class MockBiquadFilterNode {
    type: BiquadFilterType = 'peaking';
    frequency = { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() };
    Q = { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() };
    gain = { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() };
    
    connect = vi.fn().mockReturnThis();
    disconnect = vi.fn();
}

class MockAudioContext {
    currentTime = 0;
    
    createBiquadFilter(): BiquadFilterNode {
        return new MockBiquadFilterNode() as any;
    }
}

describe('FormantShifter', () => {
    let shifter: FormantShifter;
    let mockContext: AudioContext;
    
    beforeEach(() => {
        mockContext = new MockAudioContext() as any;
        shifter = new FormantShifter({ audioContext: mockContext });
    });
    
    describe('VOICE_FORMANTS', () => {
        it('should have formant values for all voice types', () => {
            expect(VOICE_FORMANTS.default).toBeDefined();
            expect(VOICE_FORMANTS.male).toBeDefined();
            expect(VOICE_FORMANTS.female).toBeDefined();
            expect(VOICE_FORMANTS.child).toBeDefined();
            expect(VOICE_FORMANTS.deep).toBeDefined();
            expect(VOICE_FORMANTS.bright).toBeDefined();
        });
        
        it('should have female formants higher than male', () => {
            expect(VOICE_FORMANTS.female.f1).toBeGreaterThan(VOICE_FORMANTS.male.f1);
            expect(VOICE_FORMANTS.female.f2).toBeGreaterThan(VOICE_FORMANTS.male.f2);
            expect(VOICE_FORMANTS.female.f3).toBeGreaterThan(VOICE_FORMANTS.male.f3);
        });
        
        it('should have child formants highest', () => {
            expect(VOICE_FORMANTS.child.f1).toBeGreaterThan(VOICE_FORMANTS.male.f1);
            expect(VOICE_FORMANTS.child.f1).toBeGreaterThan(VOICE_FORMANTS.female.f1);
        });
    });
    
    describe('calculateCharacterShift', () => {
        it('should calculate zero shift for same character', () => {
            const shift = shifter.calculateCharacterShift('male', 'male');
            
            expect(shift.f1Shift).toBeCloseTo(0, 5);
            expect(shift.f2Shift).toBeCloseTo(0, 5);
            expect(shift.f3Shift).toBeCloseTo(0, 5);
        });
        
        it('should calculate positive shift from male to female', () => {
            const shift = shifter.calculateCharacterShift('male', 'female');
            
            // Female formants are higher, so shift should be positive
            expect(shift.f1Shift).toBeGreaterThan(0);
            expect(shift.f2Shift).toBeGreaterThan(0);
            expect(shift.f3Shift).toBeGreaterThan(0);
        });
        
        it('should calculate negative shift from female to male', () => {
            const shift = shifter.calculateCharacterShift('female', 'male');
            
            // Male formants are lower, so shift should be negative
            expect(shift.f1Shift).toBeLessThan(0);
            expect(shift.f2Shift).toBeLessThan(0);
            expect(shift.f3Shift).toBeLessThan(0);
        });
        
        it('should have largest shift for child voice', () => {
            const maleToChild = shifter.calculateCharacterShift('male', 'child');
            const maleToFemale = shifter.calculateCharacterShift('male', 'female');
            
            expect(Math.abs(maleToChild.f1Shift)).toBeGreaterThan(Math.abs(maleToFemale.f1Shift));
        });
    });
    
    describe('createFilterChain', () => {
        it('should create filter nodes', () => {
            const shift = { f1Shift: 2, f2Shift: 3, f3Shift: 4 };
            const filters = shifter.createFilterChain(shift);
            
            expect(filters.length).toBeGreaterThan(0);
        });
        
        it('should connect filters in series', () => {
            const shift = { f1Shift: 2, f2Shift: 3, f3Shift: 4 };
            const filters = shifter.createFilterChain(shift);
            
            // Check that filters are connected
            for (let i = 0; i < filters.length - 1; i++) {
                expect(filters[i].connect).toHaveBeenCalled();
            }
        });
        
        it('should return input and output nodes', () => {
            const shift = { f1Shift: 2, f2Shift: 3, f3Shift: 4 };
            shifter.createFilterChain(shift);
            
            const input = shifter.getInputNode();
            const output = shifter.getOutputNode();
            
            expect(input).not.toBeNull();
            expect(output).not.toBeNull();
        });
        
        it('should store current shift', () => {
            const shift = { f1Shift: 2, f2Shift: 3, f3Shift: 4 };
            shifter.createFilterChain(shift);
            
            const current = shifter.getCurrentShift();
            expect(current).toEqual(shift);
        });
    });
    
    describe('createCharacterFilterChain', () => {
        it('should create filters for character transformation', () => {
            const filters = shifter.createCharacterFilterChain('female', 'male');
            
            expect(filters.length).toBeGreaterThan(0);
        });
        
        it('should use default as source when not specified', () => {
            const filters = shifter.createCharacterFilterChain('female');
            
            expect(filters.length).toBeGreaterThan(0);
        });
    });
    
    describe('updateFilterChain', () => {
        it('should create chain if none exists', () => {
            const shift = { f1Shift: 2, f2Shift: 3, f3Shift: 4 };
            shifter.updateFilterChain(shift);
            
            const current = shifter.getCurrentShift();
            expect(current).toEqual(shift);
        });
        
        it('should update existing chain', () => {
            const shift1 = { f1Shift: 2, f2Shift: 3, f3Shift: 4 };
            const shift2 = { f1Shift: 4, f2Shift: 5, f3Shift: 6 };
            
            shifter.createFilterChain(shift1);
            shifter.updateFilterChain(shift2);
            
            const current = shifter.getCurrentShift();
            expect(current).toEqual(shift2);
        });
    });
    
    describe('interpolateCharacters', () => {
        it('should return source at amount 0', () => {
            const shift = shifter.interpolateCharacters('male', 'female', 0);
            const maleShift = shifter.calculateCharacterShift('default', 'male');
            
            expect(shift.f1Shift).toBeCloseTo(maleShift.f1Shift, 5);
        });
        
        it('should return target at amount 1', () => {
            const shift = shifter.interpolateCharacters('male', 'female', 1);
            const femaleShift = shifter.calculateCharacterShift('default', 'female');
            
            expect(shift.f1Shift).toBeCloseTo(femaleShift.f1Shift, 5);
        });
        
        it('should interpolate at amount 0.5', () => {
            const shift = shifter.interpolateCharacters('male', 'female', 0.5);
            const maleShift = shifter.calculateCharacterShift('default', 'male');
            const femaleShift = shifter.calculateCharacterShift('default', 'female');
            
            const expected = (maleShift.f1Shift + femaleShift.f1Shift) / 2;
            expect(shift.f1Shift).toBeCloseTo(expected, 5);
        });
        
        it('should clamp amount to [0, 1]', () => {
            const shiftBelow = shifter.interpolateCharacters('male', 'female', -0.5);
            const shift0 = shifter.interpolateCharacters('male', 'female', 0);
            expect(shiftBelow).toEqual(shift0);
            
            const shiftAbove = shifter.interpolateCharacters('male', 'female', 1.5);
            const shift1 = shifter.interpolateCharacters('male', 'female', 1);
            expect(shiftAbove).toEqual(shift1);
        });
    });
    
    describe('calculateCompensatoryShift', () => {
        it('should return negative shift for positive pitch shift', () => {
            const shift = shifter.calculateCompensatoryShift(5);
            
            expect(shift.f1Shift).toBe(-5);
            expect(shift.f2Shift).toBe(-5);
            expect(shift.f3Shift).toBe(-5);
        });
        
        it('should return positive shift for negative pitch shift', () => {
            const shift = shifter.calculateCompensatoryShift(-3);
            
            expect(shift.f1Shift).toBe(3);
            expect(shift.f2Shift).toBe(3);
            expect(shift.f3Shift).toBe(3);
        });
        
        it('should return zero for zero pitch shift', () => {
            const shift = shifter.calculateCompensatoryShift(0);
            
            expect(shift.f1Shift).toBeCloseTo(0, 5);
            expect(shift.f2Shift).toBeCloseTo(0, 5);
            expect(shift.f3Shift).toBeCloseTo(0, 5);
        });
    });
    
    describe('connect and disconnect', () => {
        it('should connect source to destination through filters', () => {
            const shift = { f1Shift: 2, f2Shift: 3, f3Shift: 4 };
            shifter.createFilterChain(shift);
            
            const mockSource = new MockBiquadFilterNode() as any;
            const mockDest = new MockBiquadFilterNode() as any;
            
            shifter.connect(mockSource, mockDest);
            
            expect(mockSource.connect).toHaveBeenCalled();
        });
        
        it('should disconnect all filters', () => {
            const shift = { f1Shift: 2, f2Shift: 3, f3Shift: 4 };
            shifter.createFilterChain(shift);
            
            shifter.disconnect();
            
            expect(shifter.getInputNode()).toBeNull();
            expect(shifter.getOutputNode()).toBeNull();
        });
    });
    
    describe('setSourceFormants', () => {
        it('should update source formants', () => {
            const newFormants = { f1: 500, f2: 1500, f3: 2500 };
            shifter.setSourceFormants(newFormants);
            
            // Creating a filter chain should use new formants
            const shift = { f1Shift: 2, f2Shift: 3, f3Shift: 4 };
            shifter.createFilterChain(shift);
            
            expect(shifter.getCurrentShift()).toEqual(shift);
        });
    });
});
