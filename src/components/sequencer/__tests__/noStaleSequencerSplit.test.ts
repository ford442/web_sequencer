/**
 * Regression test for a second shadow-stack hazard found alongside the
 * sampler-playback duplicate (see docs/refactoring/module-size-budget.md):
 * an abandoned split of MainSequencer.tsx had left stale, divergent copies
 * of Sequencer.tsx / SequencerRow.tsx / SvgStep.tsx in this folder — none
 * imported from anywhere, missing bass2 support, missing keyboard grid nav,
 * missing phoneme labels, and not even wiring their own step refs into the
 * "is-current" playhead highlight. Guards both ends: those exact paths must
 * stay gone, and the live split's entry points must exist and be reachable.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SEQUENCER_DIR = resolve(__dirname, '..');
const COMPONENTS_DIR = resolve(SEQUENCER_DIR, '..');

describe('sequencer/ split has no stale abandoned duplicates', () => {
    it('does not resurrect the deleted stale top-level Sequencer.tsx orchestrator', () => {
        // Sequencer.tsx duplicated MainSequencer's role entirely and was never
        // imported from anywhere; SequencerRow.tsx/SvgStep.tsx below reuse those
        // filenames for the current, live extraction, so only this one stays gone.
        expect(existsSync(join(SEQUENCER_DIR, 'Sequencer.tsx'))).toBe(false);
    });

    it('SvgStep.tsx and SequencerRow.tsx are the current live versions, not the stale ones', () => {
        // The stale duplicates predated the bass2 track and never mentioned it;
        // the live versions style bass2 specially throughout.
        const svgStep = readFileSync(join(SEQUENCER_DIR, 'SvgStep.tsx'), 'utf8');
        const sequencerRow = readFileSync(join(SEQUENCER_DIR, 'SequencerRow.tsx'), 'utf8');
        expect(sequencerRow).toContain('bass2');
        expect(svgStep).toContain('phonemeLabel');
        expect(svgStep).toContain('onGridKeyDown');
    });

    it('MainSequencer.tsx imports the live sequencer/ split, not inline duplicates', () => {
        const source = readFileSync(join(COMPONENTS_DIR, 'MainSequencer.tsx'), 'utf8');
        expect(source).toContain("from './sequencer/SequencerRow'");
        expect(source).toContain("from './sequencer/SequencerRowWrapper'");
        expect(source).toContain("from './sequencer/AutomationStep'");
        expect(source).not.toMatch(/const SvgStep = memo/);
        expect(source).not.toMatch(/const SequencerRow = memo/);
    });

    it('sequencer/ only contains the current live modules', () => {
        const entries = readdirSync(SEQUENCER_DIR, { withFileTypes: true })
            .filter((e) => e.isFile())
            .map((e) => e.name)
            .sort();
        expect(entries).toEqual([
            'AutomationStep.tsx',
            'SequencerRow.tsx',
            'SequencerRowWrapper.tsx',
            'SvgStep.tsx',
            'TrackSlotButton.tsx',
            'constants.ts',
            'stepHitGeometry.ts',
        ]);
    });
});
