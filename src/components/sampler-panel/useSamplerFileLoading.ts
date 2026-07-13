import { useRef, useState, useCallback } from 'react';

export function useSamplerFileLoading(
  audioContext: AudioContext,
  loadBufferToBank: (buffer: AudioBuffer) => Promise<void>,
) {
  const [isDragging, setIsDragging] = useState(false);

  const loadAudioFile = useCallback(async (file: File, setStatus: (s: string) => void) => {
    setStatus('Loading...');
    try {
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      await loadBufferToBank(audioBuffer);
    } catch {
      setStatus('Load Error');
    }
  }, [audioContext, loadBufferToBank]);

  const handleFileChange = useCallback(async (
    e: React.ChangeEvent<HTMLInputElement>,
    setStatus: (s: string) => void,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await loadAudioFile(file, setStatus);
  }, [loadAudioFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(async (
    e: React.DragEvent,
    setStatus: (s: string) => void,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('audio/')) {
      await loadAudioFile(file, setStatus);
    } else {
      setStatus('Invalid File');
    }
  }, [loadAudioFile]);

  return {
    isDragging,
    handleFileChange,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };
}
