/**
 * White-chassis surface materials review (#1589) for `?visual-review=1`:
 * step-pad states, the live SVG step grid, live pads and the key bed, each
 * rendered by the real component inside `data-chassis="white"`.
 */
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ChassisLedStrip } from '../chassis/ChassisLedStrip';
import { SvgStep } from '../sequencer/SvgStep';
import { setStepPlayhead } from '../sequencer/playhead';
import { DrumPads } from '../DrumPads';
import { LiveKeyboard } from '../LiveKeyboard';
import type { TrackKey } from '../../types';

const noop = () => {};
const GRID_STEPS = 16;
const C_MAJOR: ReadonlySet<string> = new Set(['C', 'D', 'E', 'F', 'G', 'A', 'B']);
const STRIP: readonly boolean[] = Array.from({ length: 16 }, (_, i) => i % 4 === 0 || i === 6 || i === 11);
const STRIP_ACCENTS: Array<[string, string]> = [
    ['Cyan accent', 'var(--hyphon-accent-cyan)'],
    ['Pink accent', 'var(--hyphon-accent-pink)'],
    ['Yellow accent', 'var(--hyphon-accent-yellow)'],
];

/** A 16-step SvgStep row with a manual playhead (no audio, no timers). */
const StepGridDemo = memo(() => {
    const [steps, setSteps] = useState<boolean[]>(() => Array.from({ length: GRID_STEPS }, (_, i) => i % 4 === 0 || i === 10));
    const [playhead, setPlayhead] = useState(0);
    const refs = useRef<(SVGGElement | null)[]>([]);
    const lastRef = useRef(-1);

    // Same imperative path the sequencer rows use.
    useEffect(() => {
        setStepPlayhead(refs.current[lastRef.current], false);
        setStepPlayhead(refs.current[playhead], true);
        lastRef.current = playhead;
    }, [playhead, steps]);

    const handleToggle = useCallback((_k: TrackKey, i: number) => {
        setSteps((prev) => prev.map((on, j) => (j === i ? !on : on)));
    }, []);

    return (
        <div className="space-y-2">
            <svg viewBox={`216 -6 ${GRID_STEPS * 22 + 8} 62`} className="w-full" role="grid" aria-label="Step grid demo">
                <g role="row">
                    {steps.map((on, i) => (
                        <SvgStep
                            key={i}
                            stepIndex={i}
                            active={on}
                            note={on ? 'C4' : null}
                            refsArray={refs}
                            rowLabel="Demo"
                            rowKey="kick"
                            onToggle={handleToggle}
                            onRightMouseDown={noop}
                            onEditLength={noop}
                        />
                    ))}
                </g>
            </svg>
            <button
                type="button"
                className="hyphon-chassis__mode-btn"
                onClick={() => setPlayhead((p) => (p + 1) % GRID_STEPS)}
            >
                Step playhead ({playhead + 1})
            </button>
        </div>
    );
});

StepGridDemo.displayName = 'StepGridDemo';

export const ChassisSurfacesShowcase = memo(() => (
    <section className="lg:col-span-2" data-testid="chassis-surfaces-showcase">
        <h2 className="hyphon-section-label text-cyan-500/80 mb-3">White-chassis surfaces: pads, live pads, key bed (#1589)</h2>
        <div data-chassis="white" className="chassis-body p-6 space-y-5" data-testid="chassis-surfaces-body">
            <div className="space-y-2">
                <span className="chassis-label">Step pads: off / on / playhead</span>
                <div className="chassis-print-rule" />
                <div className="chassis-well p-3 space-y-3">
                    {STRIP_ACCENTS.map(([label, accent], row) => (
                        <ChassisLedStrip key={label} steps={STRIP} playhead={row * 5 + 2} accent={accent} aria-label={`${label} pad strip`} />
                    ))}
                </div>
            </div>

            <div className="space-y-2">
                <span className="chassis-label">Step grid (SvgStep, live sequencer)</span>
                <div className="chassis-print-rule" />
                <div className="chassis-well p-3">
                    <StepGridDemo />
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[1fr_auto] gap-5 items-start">
                <div className="space-y-2">
                    <span className="chassis-label">Key bed, LEDs show C major</span>
                    <div className="chassis-print-rule" />
                    <div className="chassis-well p-3 pt-10">
                        <LiveKeyboard onPlayNote={noop} onStopNote={noop} ledNotes={C_MAJOR} />
                    </div>
                </div>
                <div className="space-y-2">
                    <span className="chassis-label">Live pads</span>
                    <div className="chassis-print-rule" />
                    <div className="chassis-well p-2">
                        <DrumPads onPlayDrum={noop} />
                    </div>
                </div>
            </div>
        </div>
    </section>
));

ChassisSurfacesShowcase.displayName = 'ChassisSurfacesShowcase';
