import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Silkscreen on the white chassis must stay readable (#1589): a token edit in
 * src/styles/chassis.css cannot silently drop a label colour below WCAG AA.
 */
const css = readFileSync(resolve(__dirname, '../styles/chassis.css'), 'utf8');
const whiteBlock = css.slice(css.indexOf('[data-chassis="white"] {'), css.indexOf('}', css.indexOf('[data-chassis="white"] {')));

function token(name: string): string {
    const match = whiteBlock.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
    if (!match) throw new Error(`token ${name} not found as a 6-digit hex`);
    return match[1];
}

function luminance(hex: string): number {
    const channel = (i: number) => {
        const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

describe('white chassis token contrast', () => {
    it('red print on the body is ≥ 4.5:1 (≈ 5.6:1)', () => {
        const ratio = contrast(token('--chassis-print'), token('--chassis-body'));
        expect(ratio).toBeGreaterThanOrEqual(4.5);
        expect(ratio).toBeCloseTo(5.6, 0);
    });

    it('muted grey print and body ink are ≥ 4.5:1 on the body', () => {
        expect(contrast(token('--chassis-print-muted'), token('--chassis-body'))).toBeGreaterThanOrEqual(4.5);
        expect(contrast(token('--chassis-ink'), token('--chassis-body'))).toBeGreaterThanOrEqual(4.5);
    });

    it('red print stays ≥ 4.5:1 on the lower body gradient where labels can land', () => {
        // Panel titles sit near the top, but a label may land low on a tall stage.
        expect(contrast(token('--chassis-print'), '#e2e4e8')).toBeGreaterThanOrEqual(4.5);
    });
});
