import { useCallback } from 'react';
import type { ReverbType } from '../../types';

export function useMasterHandlers(
  setMasterVolume: React.Dispatch<React.SetStateAction<number>>,
  setMasterSaturation: React.Dispatch<React.SetStateAction<number>>,
  setGlobalPan: React.Dispatch<React.SetStateAction<number>>,
  setReverbType: React.Dispatch<React.SetStateAction<ReverbType>>,
  audioEngine: any
) {

  const handleMasterVolume = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setMasterVolume(v);
    audioEngine?.setMasterVolume(v);
  }, [setMasterVolume, audioEngine]);

  const handleMasterVolumeKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      setMasterVolume(0.8);
      audioEngine?.setMasterVolume(0.8);
    }
  }, [setMasterVolume, audioEngine]);

  const handleMasterVolumeReset = useCallback(() => {
    setMasterVolume(0.8);
    audioEngine?.setMasterVolume(0.8);
  }, [setMasterVolume, audioEngine]);


  const handleMasterSaturation = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setMasterSaturation(v);
    audioEngine?.setMasterSaturation(v);
  }, [setMasterSaturation, audioEngine]);

  const handleMasterSaturationKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      setMasterSaturation(0);
      audioEngine?.setMasterSaturation(0);
    }
  }, [setMasterSaturation, audioEngine]);

  const handleMasterSaturationReset = useCallback(() => {
    setMasterSaturation(0);
    audioEngine?.setMasterSaturation(0);
  }, [setMasterSaturation, audioEngine]);


  const handleGlobalPan = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const p = parseFloat(e.target.value);
    const val = (p > -0.1 && p < 0.1) ? 0 : p;
    setGlobalPan(val);
    audioEngine?.setGlobalPan(val);
  }, [setGlobalPan, audioEngine]);

  const handleGlobalPanKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      setGlobalPan(0);
      audioEngine?.setGlobalPan(0);
    }
  }, [setGlobalPan, audioEngine]);

  const handleGlobalPanReset = useCallback(() => {
    setGlobalPan(0);
    audioEngine?.setGlobalPan(0);
  }, [setGlobalPan, audioEngine]);

  const handleReverbType = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newType = e.target.value as ReverbType;
    setReverbType(newType);
    audioEngine?.setReverbType(newType);
  }, [setReverbType, audioEngine]);

  return {
    handleMasterVolume,
    handleMasterVolumeKeyDown,
    handleMasterVolumeReset,
    handleMasterSaturation,
    handleMasterSaturationKeyDown,
    handleMasterSaturationReset,
    handleGlobalPan,
    handleGlobalPanKeyDown,
    handleGlobalPanReset,
    handleReverbType
  };
}
