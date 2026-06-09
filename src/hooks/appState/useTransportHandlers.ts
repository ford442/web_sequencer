import { useCallback } from 'react';
import type { useAudioEngine } from '../useAudioEngine';

export function useTransportHandlers(
  isPlaying: boolean,
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>,
  audioEngine: ReturnType<typeof useAudioEngine> | null,
  startSequencer: () => Promise<void>,
  stopSequencer: () => void,
  tempo: number,
  setTempo: React.Dispatch<React.SetStateAction<number>>,
  updateAutomationLanes: () => void
) {

  const adjustTempo = useCallback((direction: number) => {
    setTempo(prev => Math.max(30, Math.min(300, prev + direction)));
  }, [setTempo]);

  const handleTempoKeyDown = useCallback((e: React.KeyboardEvent, direction: number) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      adjustTempo(direction);
    }
  }, [adjustTempo]);

  const handlePanic = useCallback(() => {
    if (audioEngine) {
      if (audioEngine.audioEngine?.stopAllNotes) {
        audioEngine.audioEngine.stopAllNotes();
      }
      setTimeout(() => {
        setIsPlaying(false);
        stopSequencer();
      }, 50);
    } else {
      setIsPlaying(false);
      stopSequencer();
    }
  }, [audioEngine, setIsPlaying, stopSequencer]);

  const handlePlayToggle = useCallback(async () => {
    if (isPlaying) {
      setIsPlaying(false);
      stopSequencer();
    } else {
      setIsPlaying(true);
      await startSequencer();
      updateAutomationLanes();
    }
  }, [isPlaying, setIsPlaying, stopSequencer, startSequencer, updateAutomationLanes]);

  const handleGlobalKeyDown = useCallback((e: KeyboardEvent) => {
    // Only handle if we aren't typing in an input or textarea
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    if (e.code === 'Space') {
      e.preventDefault();
      handlePlayToggle();
    } else if (e.code === 'Escape') {
      e.preventDefault();
      if (isPlaying) handlePlayToggle();
    }
  }, [handlePlayToggle, isPlaying]);

  return {
    adjustTempo,
    handleTempoKeyDown,
    handlePanic,
    handlePlayToggle,
    handleGlobalKeyDown
  };
}
