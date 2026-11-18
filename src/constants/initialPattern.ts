/** The pattern a new project starts with. */
import type { Pattern } from '../types';
import { NUM_STEPS } from './song';

export const INITIAL_PATTERN: Pattern = {
  partA: {
    steps: [
      // Bar 1 (C Major Arp)
      { note: 'C4', velocity: 1, length: 1 }, null, null, null,
      { note: 'E4', velocity: 1, length: 1 }, null, null, null,
      { note: 'G4', velocity: 1, length: 1 }, null, null, null,
      { note: 'E4', velocity: 1, length: 1 }, null, null, null,
      // Bar 2 (F Major Variation)
      { note: 'C4', velocity: 1, length: 1 }, null, null, null,
      { note: 'F4', velocity: 1, length: 1 }, null, null, null,
      { note: 'A4', velocity: 1, length: 1 }, null, null, null,
      { note: 'F4', velocity: 1, length: 1 }, null, null, null,
    ],
  },
  partB: {
    steps: [
      // Bar 1 (C Root)
      null, null, { note: 'C3', velocity: 0.8 }, null,
      null, null, { note: 'C3', velocity: 0.8 }, null,
      null, null, { note: 'D3', velocity: 0.8 }, null,
      null, null, { note: 'C3', velocity: 0.8 }, null,
      // Bar 2 (F Root)
      null, null, { note: 'F3', velocity: 0.8 }, null,
      null, null, { note: 'F3', velocity: 0.8 }, null,
      null, null, { note: 'G3', velocity: 0.8 }, null,
      null, null, { note: 'F3', velocity: 0.8 }, null,
    ],
  },
  bass2: {
    steps: [
      // Bar 1 (Counter bass line)
      null, null, { note: 'G2', velocity: 0.9 }, null,
      null, null, { note: 'G2', velocity: 0.7 }, null,
      null, null, { note: 'A2', velocity: 0.9 }, null,
      null, null, { note: 'G2', velocity: 0.7 }, null,
      // Bar 2 (Counter bass line variation)
      null, null, { note: 'C3', velocity: 0.9 }, null,
      null, null, { note: 'C3', velocity: 0.7 }, null,
      null, null, { note: 'D3', velocity: 0.9 }, null,
      null, null, { note: 'C3', velocity: 0.7 }, null,
    ],
  },
  kick: {
    steps: [
      // Bar 1
      { note: 'C2', velocity: 1 }, null, null, null,
      { note: 'C2', velocity: 1 }, null, null, null,
      { note: 'C2', velocity: 1 }, null, null, null,
      { note: 'C2', velocity: 1 }, null, null, null,
      // Bar 2
      { note: 'C2', velocity: 1 }, null, null, null,
      { note: 'C2', velocity: 1 }, null, null, null,
      { note: 'C2', velocity: 1 }, null, null, null,
      { note: 'C2', velocity: 1 }, null, null, null,
    ]
  },
  snare: {
    steps: [
      // Bar 1
      null, null, null, null,
      { note: 'C2', velocity: 1 }, null, null, null,
      null, null, null, null,
      { note: 'C2', velocity: 1 }, null, null, null,
      // Bar 2 (With ghost note at end)
      null, null, null, null,
      { note: 'C2', velocity: 1 }, null, null, null,
      null, null, null, null,
      { note: 'C2', velocity: 1 }, null, { note: 'C2', velocity: 0.6 }, null,
    ]
  },
  closedHat: {
    steps: [
      // Bar 1
      { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.5 }, { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.5 },
      { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.5 }, { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.5 },
      { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.5 }, { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.5 },
      { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.5 }, { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.5 },
      // Bar 2
      { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.5 }, { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.5 },
      { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.5 }, { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.5 },
      { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.5 }, { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.5 },
      { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.5 }, { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.5 },
    ]
  },
  openHat: {
    steps: [
      // Bar 1
      null, null, null, null,
      null, null, null, null,
      null, null, { note: 'C2', velocity: 0.8 }, null,
      null, null, null, null,
      // Bar 2
      null, null, null, null,
      null, null, null, null,
      null, null, { note: 'C2', velocity: 0.8 }, null,
      null, null, null, null,
    ]
  },
  sampler: Array.from({length: 8}, () => ({ steps: Array(NUM_STEPS).fill(null) }))
};
