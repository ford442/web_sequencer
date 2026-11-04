import { describe, it, expect } from 'vitest';
import { analyzeLyricSentiment } from '../lyricSentiment';

describe('analyzeLyricSentiment', () => {
    it('returns positive sentiment for happy words', () => {
        const result = analyzeLyricSentiment('I love this happy beautiful day');
        expect(result.score).toBe(3);
        expect(result.normalized).toBeGreaterThan(0.3);
    });

    it('returns negative sentiment for sad words', () => {
        const result = analyzeLyricSentiment('I hate this cold dark pain');
        expect(result.score).toBe(-4);
        expect(result.normalized).toBeLessThan(-0.3);
    });

    it('returns zero for neutral words', () => {
        const result = analyzeLyricSentiment('The dog went to the store');
        expect(result.score).toBe(0);
        expect(result.normalized).toBe(0);
    });
});
