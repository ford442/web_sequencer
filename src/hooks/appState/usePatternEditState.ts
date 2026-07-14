import { useEffect, useRef, useState } from 'react'
import type { PartSequence } from '../../types'
import type { TrackKey } from '../../constants/appDefaults'
import type { ScaleDefinition } from '../../utils/musicTheory'

export function usePatternEditState() {
    const [selectedTrack, setSelectedTrack] = useState<TrackKey>('partA')
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, track: TrackKey, step: number } | null>(null);
    const [isNoteDragging, setIsNoteDragging] = useState(false);
    const noteDragRef = useRef<{ track: TrackKey; step: number; startY: number; startMidi: number; hasMoved: boolean; lastMidi: number; pendingSequence?: PartSequence | PartSequence[]; } | null>(null);

    const [currentScale, setCurrentScale] = useState<ScaleDefinition | null>(null);
    const currentScaleRef = useRef(currentScale);
    useEffect(() => { currentScaleRef.current = currentScale; }, [currentScale]);

    const [selection, setSelection] = useState<{ trackKey: TrackKey; startStep: number; endStep: number; } | null>(null);
    const [isSelecting, setIsSelecting] = useState(false);
    const [clipboard, setClipboard] = useState<(import('../../types').Note | null)[] | null>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [drawMode, setDrawMode] = useState<'add' | 'remove' | null>(null);

    const [zoomLevel, setZoomLevel] = useState(1);

    return {
        selectedTrack, setSelectedTrack,
        contextMenu, setContextMenu,
        isNoteDragging, setIsNoteDragging,
        noteDragRef,
        currentScale, setCurrentScale,
        currentScaleRef,
        selection, setSelection,
        isSelecting, setIsSelecting,
        clipboard, setClipboard,
        isDrawing, setIsDrawing,
        drawMode, setDrawMode,
        zoomLevel, setZoomLevel,
    }
}
