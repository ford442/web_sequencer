import { useCallback, useEffect, useRef } from 'react'
import type { AudioEngine, Pattern } from '../../types'
import type { useUndoRedo } from '../useUndoRedo'

type UndoRedo = ReturnType<typeof useUndoRedo<Pattern>>

export function useTransportHandlers(deps: {
    isInitialized: boolean;
    isReady: boolean;
    initializeAudio: () => Promise<void>;
    setIsInitialized: React.Dispatch<React.SetStateAction<boolean>>;
    audioEngine: AudioEngine | null;
    setSchedPlaying: React.Dispatch<React.SetStateAction<boolean>>;
    setTempo: React.Dispatch<React.SetStateAction<number>>;
    undoRedo: UndoRedo;
    setPattern: React.Dispatch<React.SetStateAction<Pattern>>;
    activeKeyboardNotesRef: React.MutableRefObject<Map<string, number>>;
}) {
    const {
        isInitialized, isReady, initializeAudio, setIsInitialized,
        audioEngine, setSchedPlaying, setTempo, undoRedo, setPattern,
        activeKeyboardNotesRef,
    } = deps;

    const tempoHoldIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const tempoHoldTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const adjustTempo = useCallback((direction: number) => {
        setTempo(t => Math.max(30, Math.min(300, t + direction)));
    }, [setTempo]);

    const handleTempoHoldStart = useCallback((direction: number) => {
        adjustTempo(direction);
        tempoHoldTimeoutRef.current = setTimeout(() => {
            tempoHoldIntervalRef.current = setInterval(() => { adjustTempo(direction); }, 50);
        }, 300);
    }, [adjustTempo]);

    const handleTempoHoldEnd = useCallback(() => {
        if (tempoHoldTimeoutRef.current) { clearTimeout(tempoHoldTimeoutRef.current); tempoHoldTimeoutRef.current = null; }
        if (tempoHoldIntervalRef.current) { clearInterval(tempoHoldIntervalRef.current); tempoHoldIntervalRef.current = null; }
    }, []);

    const handleTempoKeyDown = useCallback((e: React.KeyboardEvent, direction: number) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            adjustTempo(direction);
        }
    }, [adjustTempo]);

    const handlePanic = useCallback(() => {
        if (!audioEngine || !audioEngine.stopAllNotes) return;
        audioEngine.stopAllNotes();
        activeKeyboardNotesRef.current.clear();
    }, [audioEngine, activeKeyboardNotesRef]);

    const handlePlayToggle = useCallback(async () => {
        if (!isInitialized) {
            await initializeAudio();
            setIsInitialized(true);
        }
        const ctx = audioEngine?.context;
        if (ctx?.state === 'suspended') {
            try {
                await ctx.resume();
            } catch (e) {
                console.warn('[transport] AudioContext.resume() failed:', e);
            }
        }
        if (!isReady) {
            console.warn('[transport] Audio engine not ready yet — playback may not start');
        }
        setSchedPlaying(prev => !prev);
    }, [isInitialized, initializeAudio, audioEngine, isReady, setSchedPlaying, setIsInitialized]);

    useEffect(() => {
        const handleGlobalKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            const inTextField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

            if (e.code === 'Space') {
                if (inTextField) return;
                e.preventDefault();
                void handlePlayToggle();
                return;
            }

            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
                if (inTextField) return;
                e.preventDefault();
                const prev = undoRedo.undo();
                if (prev) setPattern(prev);
                return;
            }

            if (((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z') ||
                ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y')) {
                if (inTextField) return;
                e.preventDefault();
                const next = undoRedo.redo();
                if (next) setPattern(next);
                return;
            }
        };
        window.addEventListener('keydown', handleGlobalKeyDown);
        return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    }, [handlePlayToggle, undoRedo, setPattern]);

    return {
        adjustTempo,
        handleTempoHoldStart,
        handleTempoHoldEnd,
        handleTempoKeyDown,
        handlePanic,
        handlePlayToggle,
        tempoHoldIntervalRef,
        tempoHoldTimeoutRef,
    };
}
