import { memo } from 'react';
import { NUM_STEPS } from '../constants';
import { STEP_PITCH, STEP_VISUAL_WIDTH } from './sequencer/stepHitGeometry';

interface GridIndicatorsProps {
    /** Columns drawn by the row (pattern length, or longer when a track loop exceeds it). */
    columns?: number;
    /** 16th-note steps per beat — a small tick. */
    stepsPerBeat?: number;
    /** 16th-note steps per bar — a tall cyan tick. */
    stepsPerBar?: number;
}

export const GridIndicators = memo(({ columns = NUM_STEPS, stepsPerBeat = 4, stepsPerBar = 16 }: GridIndicatorsProps) => {
    const indicators = [];
    for (let i = 0; i < columns; i += stepsPerBeat) {
        const isMeasure = i % stepsPerBar === 0;
        const x = 220 + i * STEP_PITCH + STEP_VISUAL_WIDTH / 2; // Centered on the step

        indicators.push(
            <g key={`grid-${i}`}>
                {/* Tick Mark above row */}
                <rect
                    x={x - (isMeasure ? 2 : 1)}
                    y={-8}
                    width={isMeasure ? 4 : 2}
                    height={isMeasure ? 6 : 4}
                    fill={isMeasure ? "#06b6d4" : "#4b5563"}
                    rx={1}
                />
            </g>
        );
    }
    return <>{indicators}</>;
});
