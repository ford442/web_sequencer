import { memo } from 'react';

export const GridIndicators = memo(() => {
    const indicators = [];
    for (let i = 0; i < 32; i += 4) { // Every 4 steps = 1 beat
        const isMeasure = i % 16 === 0; // Every 16 steps = 1 bar/measure
        const x = 220 + i * (18 + 4) + 9; // Centered on the step

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
