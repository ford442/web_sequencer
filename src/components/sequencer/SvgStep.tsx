import { memo } from 'react';
import { getNoteColor } from '../../utils/noteColors';
import type { TrackKey } from '../../types';
import { TRACK_COLORS } from './constants';
import { getStepHitRect } from './stepHitGeometry';

interface SvgStepProps {
    stepIndex: number, active: boolean, note?: string | null, refsArray: React.MutableRefObject<(SVGGElement | null)[]>,
    rowLabel: string, rowKey: TrackKey, onToggle: (k: TrackKey, i: number, e: React.PointerEvent | React.KeyboardEvent) => void,
    onRightMouseDown: (k: TrackKey, i: number, e: React.MouseEvent) => void,
    onEditLength: (k: TrackKey, i: number, len: number) => void, length?: number, isSlide?: boolean,
    onSelectionStart?: (k: TrackKey, i: number) => void,
    onSelectionEnter?: (k: TrackKey, i: number) => void,
    isRangeSelected?: boolean,
    phonemeLabel?: string,
    retrigger?: number,
    reverse?: boolean,
    stepTabIndex?: number,
    onStepRef?: (el: SVGGElement | null) => void,
    onGridKeyDown?: (e: React.KeyboardEvent) => void,
}

export const SvgStep = memo(({
    stepIndex, active, note, refsArray, rowLabel, rowKey, onToggle, onRightMouseDown, onEditLength, length = 1, isSlide,
    onSelectionStart, onSelectionEnter, isRangeSelected, phonemeLabel, retrigger, reverse,
    stepTabIndex = -1, onStepRef, onGridKeyDown,
}: SvgStepProps) => {
    const baseWidth = 18;
    const gap = 4;
    const height = 50;
    const x = 220 + stepIndex * (baseWidth + gap);
    const totalWidth = (baseWidth * length) + (gap * (length - 1));
    const hitRect = getStepHitRect(totalWidth, height);
    const retriggerCount = retrigger || 1;
    const color = note ? getNoteColor(note, rowKey) : '#06b6d4';
    const focusColor = TRACK_COLORS[rowKey] || '#22d3ee';
    const groupIndex = Math.floor(stepIndex / 4);
    const isAltGroup = groupIndex % 2 === 1;
    const baseFill = active ? '#0d1f15' : (isAltGroup ? '#1c2229' : '#14181c');

    const beginLengthEdit = (target: Element, pointerId: number, startX: number, startLength: number) => {
        target.setPointerCapture(pointerId);
        const sensitivity = 20;
        const handlePointerMove = (ev: PointerEvent) => {
            const delta = ev.clientX - startX;
            const stepsToAdd = Math.floor(delta / sensitivity);
            const newLength = Math.max(1, Math.min(16, startLength + stepsToAdd));
            if (newLength !== length) { onEditLength(rowKey, stepIndex, newLength); }
        };
        const handlePointerUp = (ev: PointerEvent) => {
            target.removeEventListener('pointermove', handlePointerMove as EventListener);
            target.removeEventListener('pointerup', handlePointerUp as EventListener);
            target.releasePointerCapture(ev.pointerId);
        };
        target.addEventListener('pointermove', handlePointerMove as EventListener);
        target.addEventListener('pointerup', handlePointerUp as EventListener);
    };

    const handlePointerDown = (e: React.PointerEvent) => {
        if (e.button === 2) { e.preventDefault(); onRightMouseDown(rowKey, stepIndex, e); return; }
        if (e.shiftKey) {
            e.preventDefault(); e.stopPropagation();
            if (active) {
                // Length Editing
                const target = e.currentTarget as Element;
                beginLengthEdit(target, e.pointerId, e.clientX, length);
            } else if (onSelectionStart) {
                // Range Selection
                onSelectionStart(rowKey, stepIndex);
            }
            return;
        }
        if (!active && !e.altKey && !e.ctrlKey && !e.metaKey) {
            onToggle(rowKey, stepIndex, e);
            beginLengthEdit(e.currentTarget as Element, e.pointerId, e.clientX, 1);
            return;
        }
        onToggle(rowKey, stepIndex, e);
    };

    const handlePointerEnter = () => {
        if (onSelectionEnter) onSelectionEnter(rowKey, stepIndex);
    };


    return (
        <g transform={`translate(${x}, 0)`} ref={(el) => { refsArray.current[stepIndex] = el; onStepRef?.(el); }} className="svg-step" role="gridcell" tabIndex={0} data-testid={`step-${rowKey}-${stepIndex}`} aria-label={`${rowLabel} step ${stepIndex + 1}, ${active ? "Active" : "Inactive"}`} aria-pressed={active} onPointerDown={handlePointerDown} onPointerEnter={handlePointerEnter} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(rowKey, stepIndex, e); } else { onGridKeyDown?.(e); } }} onContextMenu={(e) => e.preventDefault()} cursor="pointer" style={{ transition: 'all 0.1s ease', touchAction: 'none', '--focus-color': focusColor } as React.CSSProperties}>
            {active && <rect className="step-glow" x={-4} y={-4} width={totalWidth + 8} height={height + 8} rx={6} fill={color} fillOpacity={0.4} filter="blur(6px)" />}
            {isRangeSelected && <rect className="step-selection" x={-2} y={-2} width={totalWidth + 4} height={height + 4} rx={4} fill="none" stroke="#ffffff" strokeWidth={2} strokeOpacity={0.8} style={{ pointerEvents: 'none' }} />}
            <rect x={0} y={0} width={totalWidth} height={height} rx={3} fill="#050505" />
            {active && isSlide && <rect x={4} y={height - 8} width={totalWidth - 8} height={3} rx={1} fill="#fbbf24" fillOpacity={1} style={{ mixBlendMode: 'plus-lighter' }} />}
            <rect x={1} y={1} width={totalWidth - 2} height={height - 2} rx={2} fill={baseFill} strokeWidth={0} />

            {/* Retrigger Indicators */}
            {active && retriggerCount > 1 && Array.from({ length: retriggerCount - 1 }).map((_, i) => (
                <rect key={i} x={(totalWidth / retriggerCount) * (i + 1)} y={2} width={1} height={height - 4} fill="rgba(255,255,255,0.3)" />
            ))}

            <path d={`M 2 2 L ${totalWidth - 2} 2 L ${totalWidth - 4} 4 L 4 4 L 4 ${height - 4} L 2 ${height - 2} Z`} fill="rgba(255,255,255,0.2)" />
            <path d={`M ${totalWidth - 2} 2 L ${totalWidth - 2} ${height - 2} L 2 ${height - 2} L 4 ${height - 4} L ${totalWidth - 4} ${height - 4} L ${totalWidth - 4} 4 Z`} fill="rgba(0,0,0,0.5)" />
            <rect className="step-cap" x={3} y={4} width={totalWidth - 6} height={height - 8} rx={1} fill={active ? color : '#1a2026'} fillOpacity={active ? 0.6 : 1} stroke={active ? color : 'none'} strokeWidth={active ? 1 : 0} />
            {phonemeLabel && (
                <text x={totalWidth / 2} y={height / 2 + 4} textAnchor="middle" fontSize={10} fill="#fff" fontWeight="bold" fontFamily="monospace" pointerEvents="none" style={{ textShadow: '0 0 3px #000' }}>{phonemeLabel}</text>
            )}
            {active && reverse && (
                <path d="M 12 25 L 16 21 L 16 29 Z" fill="rgba(255,255,255,0.8)" pointerEvents="none" />
            )}
            {length > 1 && (<g pointerEvents="none"><g opacity={0.3} fill="#000"><rect x={totalWidth / 2 - 2} y={height / 2 - 10} width={4} height={20} rx={1} /><rect x={totalWidth / 2 - 8} y={height / 2 - 10} width={4} height={20} rx={1} /><rect x={totalWidth / 2 + 4} y={height / 2 - 10} width={4} height={20} rx={1} /></g><g transform={`translate(${totalWidth - 25}, 8)`}><rect width={20} height={14} rx={3} fill="#000" fillOpacity={0.6} /><text x={10} y={10} textAnchor="middle" fontSize={9} fill="#fff" fontWeight="bold" fontFamily="monospace">{length}x</text></g></g>)}
            <rect x={4} y={5} width={totalWidth - 8} height={(height - 10) / 2} rx={1} fill="url(#glassGrad)" fillOpacity={0.3} pointerEvents="none" />
            <rect className="step-led" x={5} y={height - 10} width={totalWidth - 10} height={3} rx={1} fill={active ? '#ccffcc' : '#000'} fillOpacity={active ? 0.8 : 0.2} style={{ pointerEvents: 'none' }} />
            <rect className="step-hit-target" x={hitRect.x} y={hitRect.y} width={hitRect.width} height={hitRect.height} fill="transparent" />
        </g>
    )
}, (prev: SvgStepProps, next: SvgStepProps) => {
    return (
        prev.stepIndex === next.stepIndex &&
        prev.active === next.active &&
        prev.note === next.note &&
        prev.length === next.length &&
        prev.isSlide === next.isSlide &&
        prev.isRangeSelected === next.isRangeSelected &&
        prev.phonemeLabel === next.phonemeLabel &&
        prev.retrigger === next.retrigger &&
        prev.reverse === next.reverse &&
        prev.stepTabIndex === next.stepTabIndex
    );
});
