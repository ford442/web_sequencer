/**
 * Example AI song with automation lanes, for documentation and tests.
 * Re-exported from `automation.ts`.
 */

import type { AISongData } from './types';

/**
 * Example AI Song with automation for documentation and testing.
 * 
 * Demonstrates filter sweeps on synthA and delay mix automation on synthB.
 */
export const EXAMPLE_WITH_AUTOMATION: AISongData = {
  meta: { 
    title: "Acid with Filter Sweep", 
    author: "AI Demo", 
    version: "1.0", 
    createdAt: "2024-03-06T12:00:00Z", 
    generator: "claude-3-opus", 
    prompt: "Acid techno with filter automation",
    tags: ["techno", "acid", "automation"]
  },
  globals: { 
    tempo: 130, 
    timeSignature: [4, 4], 
    swing: 52 
  },
  tracks: {
    synthA: { 
      notes: [
        {step: 0, note: "C2", velocity: 0.9, accent: true},
        {step: 2, note: "C2"},
        {step: 4, note: "Eb2", accent: true, slide: true},
        {step: 6, note: "F2"},
        {step: 8, note: "C2", accent: true},
        {step: 12, note: "G2", accent: true, slide: true},
        {step: 14, note: "Bb2"}
      ], 
      params: { 
        waveform: "303-saw", 
        filterCutoff: 1500, 
        filterResonance: 18, 
        decay: 0.4
      } 
    },
    kick: [
      true, false, false, false, true, false, false, false,
      true, false, false, false, true, false, false, false
    ],
    snare: [
      false, false, false, false, true, false, false, false,
      false, false, false, false, true, false, false, false
    ],
    closedHat: [
      false, true, false, true, false, true, false, true,
      false, true, false, true, false, true, false, true
    ]
  },
  automation: [
    {
      target: 'synthA',
      parameter: 'filterCutoff',
      steps: [
        100, 110, 120, 127, 120, 110, 100, 90,
        null, null, 100, 110, 120, 127, 120, 100
      ],
      interpolation: 'linear'
    },
    {
      target: 'synthB',
      parameter: 'delayMix',
      steps: [
        0, 0, 10, 20, 30, 40, 50, 60,
        70, 80, 90, 100, 100, 100, 80, 60
      ],
      interpolation: 'smooth'
    }
  ]
};
