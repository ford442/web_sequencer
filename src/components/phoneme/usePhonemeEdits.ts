import { useCallback } from 'react';
import type React from 'react';
import type { PhonemeData } from '@/types';
import { clampElasticity } from '@/engines/rubberband/phonemeElasticity';

const STEP_SIZE = 0.01; // 1% move
const BIG_STEP = 0.05;  // 5% resize
const MIN_WIDTH = 0.05;
const ELASTICITY_STEP = 0.05;
const ELASTICITY_BIG_STEP = 0.25;

type SetPhonemes = React.Dispatch<React.SetStateAction<PhonemeData[]>>;

/** Rounds to the 1% grid the painter shows, then clamps to 0.5–1.5. */
export const snapElasticity = (value: number) => clampElasticity(Math.round(value * 100) / 100);

/**
 * Edit operations for the Phoneme Painter's local phoneme list: per-phoneme
 * updates, delete, pitch bend, elasticity, and the pill keyboard map.
 * Extracted from PhonemePainter.tsx so the component stays layout.
 */
export function usePhonemeEdits(
  phonemes: PhonemeData[],
  setPhonemes: SetPhonemes,
  selectedId: string | null,
  setSelectedId: (id: string | null) => void,
) {
  const updatePhoneme = useCallback((id: string, update: (p: PhonemeData) => PhonemeData) => {
    setPhonemes(prev => {
      const idx = prev.findIndex(p => p.id === id);
      if (idx === -1) return prev;
      const next = [...prev];
      next[idx] = update(next[idx]);
      return next;
    });
  }, [setPhonemes]);

  const handleDelete = useCallback((id: string) => {
    setPhonemes(prev => prev.filter(p => p.id !== id));
    if (selectedId === id) setSelectedId(null);
  }, [setPhonemes, selectedId, setSelectedId]);

  const handlePitchBendChange = useCallback((id: string, bend: number) => {
    updatePhoneme(id, p => ({ ...p, pitchBend: bend }));
  }, [updatePhoneme]);

  const handleElasticityChange = useCallback((id: string, elasticity: number) => {
    updatePhoneme(id, p => ({ ...p, elasticity: snapElasticity(elasticity) }));
  }, [updatePhoneme]);

  const handleVolumeChange = useCallback((id: string, volume: number) => {
    updatePhoneme(id, p => ({ ...p, volume }));
  }, [updatePhoneme]);

  // Keyboard map for a focused phoneme pill
  const handlePhonemeKeyDown = (e: React.KeyboardEvent, phonemeId: string) => {
    const phonemeIndex = phonemes.findIndex(p => p.id === phonemeId);
    if (phonemeIndex === -1) return;

    const move = (toStart: (p: PhonemeData, duration: number) => number) =>
      updatePhoneme(phonemeId, p => {
        const duration = p.end - p.start;
        const start = toStart(p, duration);
        return { ...p, start, end: start + duration };
      });

    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        if (e.shiftKey) {
          updatePhoneme(phonemeId, p => ({ ...p, end: Math.min(1, p.end + BIG_STEP) }));
        } else {
          move((p, d) => Math.min(1 - d, p.start + STEP_SIZE));
        }
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (e.shiftKey) {
          updatePhoneme(phonemeId, p => ({ ...p, end: Math.max(p.start + MIN_WIDTH, p.end - BIG_STEP) }));
        } else {
          move(p => Math.max(0, p.start - STEP_SIZE));
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        updatePhoneme(phonemeId, p => ({ ...p, pitchBend: Math.min(100, p.pitchBend + (e.shiftKey ? 20 : 5)) }));
        break;
      case 'ArrowDown':
        e.preventDefault();
        updatePhoneme(phonemeId, p => ({ ...p, pitchBend: Math.max(-100, p.pitchBend - (e.shiftKey ? 20 : 5)) }));
        break;
      case ']':
      case '[': {
        e.preventDefault();
        const delta = (e.key === ']' ? 1 : -1) * (e.shiftKey ? ELASTICITY_BIG_STEP : ELASTICITY_STEP);
        updatePhoneme(phonemeId, p => ({ ...p, elasticity: snapElasticity(clampElasticity(p.elasticity) + delta) }));
        break;
      }
      case 'Home':
        e.preventDefault();
        move(() => 0);
        break;
      case 'End':
        e.preventDefault();
        move((_, d) => 1 - d);
        break;
      case 'Delete':
      case 'Backspace': {
        e.preventDefault();
        handleDelete(phonemeId);
        // Focus next phoneme or add button
        const nextPhoneme = phonemes[phonemeIndex + 1];
        if (nextPhoneme) {
          setSelectedId(nextPhoneme.id);
        }
        break;
      }
      case 'Tab': {
        // Navigate between phonemes
        const target = phonemes[phonemeIndex + (e.shiftKey ? -1 : 1)];
        if (target) {
          e.preventDefault();
          setSelectedId(target.id);
        }
        break;
      }
    }
  };

  return {
    handleDelete,
    handlePitchBendChange,
    handleElasticityChange,
    handleVolumeChange,
    handlePhonemeKeyDown,
  };
}
