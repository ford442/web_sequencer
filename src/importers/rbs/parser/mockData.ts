import type {
  Tb303PatternA, Tb303PatternB, DrumPattern, PcfSettings, AutomationLane,
} from '../types';

export function generateEmptyTb303Pattern(): Tb303PatternA {
  const steps: Tb303PatternA['steps'] = Array.from({ length: 16 }, (_, index) => ({
    index,
    note: -1,
    octave: 3,
    accent: false,
    slide: false,
    tie: false,
    gate: 100,
  }));

  return {
    steps,
    cutoff: 64,
    resonance: 48,
    envMod: 64,
    decay: 48,
    accent: 80,
    waveform: 0,
    distortion: 0,
    delaySend: 0,
  };
}

export function generateEmptyTb303PatternB(): Tb303PatternB {
  return {
    ...generateEmptyTb303Pattern(),
    transpose: 0,
  };
}

export function generateEmptyDrumPattern(): DrumPattern {
  const silent = Array(16).fill(false);
  return {
    kick: [...silent],
    snare: [...silent],
    closedHat: [...silent],
    openHat: [...silent],
    kitType: '808',
  };
}

export function generateMockTb303Pattern(): Tb303PatternA {
  const steps: Tb303PatternA['steps'] = [];
  const notes = [0, 0, 7, 7, 9, 9, 7, -1, 5, 5, 4, 4, 2, 2, 0, -1];

  for (let i = 0; i < 16; i++) {
    steps.push({
      index: i,
      note: notes[i] ?? -1,
      octave: notes[i] === -1 ? 3 : 3,
      accent: i === 3 || i === 7 || i === 11 || i === 15,
      slide: i === 6 || i === 14,
      tie: false,
      gate: 100,
    });
  }

  return {
    steps,
    cutoff: 64,
    resonance: 48,
    envMod: 64,
    decay: 48,
    accent: 80,
    waveform: 1,
    distortion: 0,
    delaySend: 0,
  };
}

export function generateMockTb303PatternB(): Tb303PatternB {
  const pattern = generateMockTb303Pattern();
  return {
    ...pattern,
    transpose: 0,
  };
}

export function generateMockDrumPattern(): DrumPattern {
  const kick = [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false];
  const snare = [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false];
  const closedHat = [false, true, false, true, false, true, false, true, false, true, false, true, false, true, false, true];
  const openHat = [false, false, false, false, false, false, false, false, false, false, false, false, false, false, true, false];

  return {
    kick,
    snare,
    closedHat,
    openHat,
    accent: Array(16).fill(0),
    kitType: '808',
    tuning: {
      kick: 0,
      snare: 0,
      closedHat: 0,
      openHat: 0,
    },
    decay: {
      kick: 64,
      snare: 48,
      closedHat: 32,
      openHat: 64,
    },
  };
}

export function generateMockPcfSettings(): PcfSettings {
  return {
    enabled: true,
    filterType: 'lp',
    cutoff: 80,
    resonance: 40,
    envAmount: 60,
    decay: 40,
    pattern: Array(16).fill(0).map((_, i) => Math.floor(40 + Math.sin(i * Math.PI / 8) * 30)),
    target: {
      tb303A: true,
      tb303B: false,
      drums: false,
    },
  };
}

export function generateMockAutomation(): AutomationLane[] {
  return [
    {
      parameter: 'tempo',
      name: 'Tempo',
      points: [[0, 128], [8, 130], [15, 128]],
      interpolation: 'linear',
      range: [60, 200],
    },
  ];
}
