import { memo, useRef } from 'react';
import type { PointerEvent, MouseEvent, MutableRefObject, CSSProperties } from 'react';
import type { TrackKey } from '../../types';
import { TRACK_COLORS } from './constants';
import { getNoteColor } from '../../utils/noteColors';

interface SvgStepProps {
    stepIndex: number;
    active: boolean;
    note?: string | null;
    refsArray: MutableRefObject<(SVGGElement | null)[]>;
    rowLabel: string;
    rowKey: TrackKey;
    onToggle: (k: TrackKey, i: number, e: PointerEvent | React.KeyboardEvent) => void;
    onRightMouseDown: (k: TrackKey, i: number, e: MouseEvent) => void;
    onEditLength: (k: TrackKey, i: number, len: number) => void;
    length?: number;
    isSlide?: boolean;
    onSelectionStart?: (k: TrackKey, i: number) => void;
    onSelectionEnter?: (k: TrackKey, i: number) => void;
    isRangeSelected?: boolean;
    onDrawEnter?: (k: TrackKey, i: number) => void;
    isDrawing?: boolean;
}

export const SvgStep = memo(({
    stepIndex, active, note, refsArray: _refsArray, rowLabel, rowKey, onToggle, onRightMouseDown, onEditLength, length = 1, isSlide,
    onSelectionStart, onSelectionEnter, isRangeSelected, onDrawEnter, isDrawing
}: SvgStepProps) => {
    const baseWidth = 18;
    const gap = 4;
    const height = 50;
    const x = 220 + stepIndex * (baseWidth + gap);
    const totalWidth = (baseWidth * length) + (gap * (length - 1));
    const color = note ? getNoteColor(note, rowKey) : '#06b6d4';
    const focusColor = TRACK_COLORS[rowKey] || '#22d3ee';
    const groupIndex = Math.floor(stepIndex / 4);
    const isAltGroup = groupIndex % 2 === 1;
    const baseFill = active ? '#0d1f15' : (isAltGroup ? '#1c2229' : '#14181c');

    const handlePointerDown = (e: PointerEvent) => {
        if (e.button === 2) { e.preventDefault(); onRightMouseDown(rowKey, stepIndex, e); return; }
        if (e.shiftKey) {
            e.preventDefault(); e.stopPropagation();
            if (active) {
                // Length Editing
                const target = e.currentTarget as Element;
                target.setPointerCapture(e.pointerId);
                const startX = e.clientX;
                const startLength = length;
                const sensitivity = 20;
                const handlePointerMove = (ev: any) => {
                    const delta = ev.clientX - startX;
                    const stepsToAdd = Math.floor(delta / sensitivity);
                    const newLength = Math.max(1, Math.min(16, startLength + stepsToAdd));
                    if (newLength !== length) { onEditLength(rowKey, stepIndex, newLength); }
                };
                const handlePointerUp = (ev: any) => {
                    target.removeEventListener('pointermove', handlePointerMove);
                    target.removeEventListener('pointerup', handlePointerUp);
                    target.releasePointerCapture(ev.pointerId);
                };
                target.addEventListener('pointermove', handlePointerMove);
                target.addEventListener('pointerup', handlePointerUp);
            } else if (onSelectionStart) {
                // Range Selection
                onSelectionStart(rowKey, stepIndex);
            }
        } else { onToggle(rowKey, stepIndex, e); }
    };

    const handlePointerEnter = () => {
        if (isDrawing && onDrawEnter) onDrawEnter(rowKey, stepIndex);
        if (onSelectionEnter) onSelectionEnter(rowKey, stepIndex);
    };

    // Use local ref and avoid mutating props
    const localRef = useRef<SVGGElement | null>(null);

    return (
        <g 
            transform={`translate(${x}, 0)`} 
            ref={localRef}
            className="svg-step" 
            role="button" 
            tabIndex={0} 
            aria-label={`${rowLabel} step ${stepIndex + 1}${active ? ', active' : ''}`}
            aria-pressed={active}
            onPointerDown={handlePointerDown} 
            onPointerEnter={handlePointerEnter} 
            onKeyDown={(e) => { 
                if (e.key === 'Enter' || e.key === ' ') { 
                    e.preventDefault(); 
                    onToggle(rowKey, stepIndex, e); 
                }
            }} 
            onContextMenu={(e) => e.preventDefault()} 
            cursor="pointer" 
            style={{ transition: 'all 0.1s ease', touchAction: 'manipulation', '--focus-color': focusColor } as CSSProperties}
        >
            {active && <rect className="step-glow" x={-4} y={-4} width={totalWidth + 8} height={height + 8} rx={6} fill={color} fillOpacity={0.4} filter="blur(6px)" />}
            {isRangeSelected && <rect className="step-selection" x={-2} y={-2} width={totalWidth + 4} height={height + 4} rx={4} fill="none" stroke="#ffffff" strokeWidth={2} strokeOpacity={0.8} style={{ pointerEvents: 'none' }} />}
            <rect x={0} y={0} width={totalWidth} height={height} rx={3} fill="#050505" />
            {active && isSlide && <rect x={4} y={height - 8} width={totalWidth - 8} height={3} rx={1} fill="#fbbf24" fillOpacity={1} style={{ mixBlendMode: 'plus-lighter' }} />}
            <rect x={1} y={1} width={totalWidth - 2} height={height - 2} rx={2} fill={baseFill} strokeWidth={0} />
            <path d={`M 2 2 L ${totalWidth - 2} 2 L ${totalWidth - 4} 4 L 4 4 L 4 ${height - 4} L 2 ${height - 2} Z`} fill="rgba(255,255,255,0.2)" />
            <path d={`M ${totalWidth - 2} 2 L ${totalWidth - 2} ${height - 2} L 2 ${height - 2} L 4 ${height - 4} L ${totalWidth - 4} ${height - 4} L ${totalWidth - 4} 4 Z`} fill="rgba(0,0,0,0.5)" />
            <rect className="step-cap" x={3} y={4} width={totalWidth - 6} height={height - 8} rx={1} fill={active ? color : '#1a2026'} fillOpacity={active ? 0.6 : 1} stroke={active ? color : 'none'} strokeWidth={active ? 1 : 0} />
            {length > 1 && (<g pointerEvents="none"><g opacity={0.3} fill="#000"><rect x={totalWidth / 2 - 2} y={height / 2 - 10} width={4} height={20} rx={1} /><rect x={totalWidth / 2 - 8} y={height / 2 - 10} width={4} height={20} rx={1} /><rect x={totalWidth / 2 + 4} y={height / 2 - 10} width={4} height={20} rx={1} /></g><g transform={`translate(${totalWidth - 25}, 8)`}><rect width={20} height={14} rx={3} fill="#000" fillOpacity={0.6} /><text x={10} y={10} textAnchor="middle" fontSize={9} fill="#fff" fontWeight="bold" fontFamily="monospace">{length}x</text></g></g>)}
            <rect x={4} y={5} width={totalWidth - 8} height={(height - 10) / 2} rx={1} fill="url(#glassGrad)" fillOpacity={0.3} pointerEvents="none" />
            <rect className="step-led" x={5} y={height - 10} width={totalWidth - 10} height={3} rx={1} fill={active ? '#ccffcc' : '#000'} fillOpacity={active ? 0.8 : 0.2} />
        </g>
    )
});
