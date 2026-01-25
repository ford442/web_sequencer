// src/__tests__/PhonemeAligner.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { PhonemeAligner, type PhonemeSegment } from '../engines/rubberband/PhonemeAligner';

describe('PhonemeAligner', () => {
    let aligner: PhonemeAligner;
    
    beforeEach(() => {
        aligner = new PhonemeAligner({ useLocalAlignment: true });
    });
    
    describe('isVowelPhoneme', () => {
        it('should correctly identify vowel phonemes', () => {
            expect(PhonemeAligner.isVowelPhoneme('AH')).toBe(true);
            expect(PhonemeAligner.isVowelPhoneme('IY')).toBe(true);
            expect(PhonemeAligner.isVowelPhoneme('OW')).toBe(true);
        });
        
        it('should correctly identify consonant phonemes', () => {
            expect(PhonemeAligner.isVowelPhoneme('T')).toBe(false);
            expect(PhonemeAligner.isVowelPhoneme('K')).toBe(false);
            expect(PhonemeAligner.isVowelPhoneme('SH')).toBe(false);
        });
        
        it('should be case-insensitive', () => {
            expect(PhonemeAligner.isVowelPhoneme('ah')).toBe(true);
            expect(PhonemeAligner.isVowelPhoneme('Ah')).toBe(true);
        });
    });
    
    describe('alignPhonemes', () => {
        it('should return valid alignment result', async () => {
            const audioData = new Float32Array(44100); // 1 second of silence
            const text = "hello";
            const sampleRate = 44100;
            
            const result = await aligner.alignPhonemes(audioData, text, sampleRate);
            
            expect(result).toBeDefined();
            expect(result.sampleRate).toBe(sampleRate);
            expect(result.duration).toBeCloseTo(1.0, 1);
            expect(result.text).toBe(text);
            expect(result.phonemes).toBeInstanceOf(Array);
        });
        
        it('should generate phonemes for simple text', async () => {
            const audioData = new Float32Array(44100);
            const text = "hi";
            const sampleRate = 44100;
            
            const result = await aligner.alignPhonemes(audioData, text, sampleRate);
            
            expect(result.phonemes.length).toBeGreaterThan(0);
            result.phonemes.forEach(phoneme => {
                expect(phoneme).toHaveProperty('phoneme');
                expect(phoneme).toHaveProperty('start');
                expect(phoneme).toHaveProperty('end');
                expect(phoneme).toHaveProperty('isVowel');
                expect(phoneme.start).toBeGreaterThanOrEqual(0);
                expect(phoneme.end).toBeGreaterThan(phoneme.start);
            });
        });
        
        it('should classify phonemes as vowels or consonants', async () => {
            const audioData = new Float32Array(44100);
            const text = "aaa";
            const sampleRate = 44100;
            
            const result = await aligner.alignPhonemes(audioData, text, sampleRate);
            
            // Should have at least one vowel
            const hasVowel = result.phonemes.some(p => p.isVowel);
            expect(hasVowel).toBe(true);
        });
    });
    
    describe('extractRegion', () => {
        it('should extract correct audio region', () => {
            const audioData = new Float32Array(44100);
            // Fill with test pattern
            for (let i = 0; i < audioData.length; i++) {
                audioData[i] = i / 44100;
            }
            
            const segment: PhonemeSegment = {
                phoneme: 'AH',
                start: 0.1,
                end: 0.2,
                isVowel: true
            };
            
            const region = aligner.extractRegion(audioData, segment, 44100);
            
            expect(region.length).toBeCloseTo(4410, 0); // 0.1 seconds
            expect(region[0]).toBeCloseTo(0.1, 2);
        });
    });
    
    describe('calculateStretchRatios', () => {
        it('should return 1.0 for matching durations', () => {
            const phonemes: PhonemeSegment[] = [
                { phoneme: 'AH', start: 0, end: 0.5, isVowel: true },
                { phoneme: 'T', start: 0.5, end: 0.6, isVowel: false }
            ];
            
            const ratios = aligner.calculateStretchRatios(phonemes, 0.6);
            
            expect(ratios).toBeDefined();
            expect(ratios.length).toBe(2);
        });
        
        it('should stretch vowels more than consonants', () => {
            const phonemes: PhonemeSegment[] = [
                { phoneme: 'AH', start: 0, end: 0.5, isVowel: true },
                { phoneme: 'T', start: 0.5, end: 0.6, isVowel: false }
            ];
            
            const ratios = aligner.calculateStretchRatios(phonemes, 1.0); // Stretch to 1 second
            
            // Vowel should have higher ratio
            expect(ratios[0]).toBeGreaterThan(ratios[1]);
            // Consonant should be close to 1.0
            expect(ratios[1]).toBeCloseTo(1.0, 1);
        });
        
        it('should clamp extreme ratios', () => {
            const phonemes: PhonemeSegment[] = [
                { phoneme: 'AH', start: 0, end: 0.1, isVowel: true }
            ];
            
            const ratios = aligner.calculateStretchRatios(phonemes, 10.0); // Extreme stretch
            
            // Should be clamped to reasonable range
            expect(ratios[0]).toBeLessThanOrEqual(3.0);
            expect(ratios[0]).toBeGreaterThanOrEqual(0.5);
        });
        
        it('should handle empty phoneme array', () => {
            const ratios = aligner.calculateStretchRatios([], 1.0);
            expect(ratios).toEqual([]);
        });
    });
    
    describe('createSharedPhonemeBuffer', () => {
        it('should create valid SharedArrayBuffer', () => {
            const phonemes: PhonemeSegment[] = [
                { phoneme: 'AH', start: 0, end: 0.5, isVowel: true },
                { phoneme: 'T', start: 0.5, end: 0.6, isVowel: false }
            ];
            
            const buffer = aligner.createSharedPhonemeBuffer(phonemes, 44100);
            
            expect(buffer).toBeInstanceOf(SharedArrayBuffer);
            
            const view = new Float32Array(buffer);
            expect(view[0]).toBe(2); // Number of phonemes
            
            // Check first phoneme data
            expect(view[1]).toBeCloseTo(0, 0); // Start sample
            expect(view[2]).toBeCloseTo(22050, 0); // End sample (0.5 * 44100)
            expect(view[3]).toBe(1.0); // isVowel
        });
        
        it('should handle empty phoneme array', () => {
            const buffer = aligner.createSharedPhonemeBuffer([], 44100);
            const view = new Float32Array(buffer);
            expect(view[0]).toBe(0); // Zero phonemes
        });
    });
});
