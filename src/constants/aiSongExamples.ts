import type { AISongData } from '../importers/ai-song';

export const PROMPT_TEMPLATE = `You are a music sequencer AI for Hyphon (a web-based DAW).
Generate a complete song in the following JSON format.

HYPHON SONG FORMAT:
{
  "meta": {
    "title": "Song Name",
    "author": "your-name",
    "version": "1.0",
    "createdAt": "2024-03-06T12:00:00Z",
    "generator": "claude-3-opus",
    "prompt": "brief description"
  },
  "globals": {
    "tempo": 128,
    "timeSignature": [4, 4],
    "swing": 50
  },
  "tracks": {
    "synthA": {
      "notes": [
        {"step": 0, "note": "C3", "velocity": 0.8, "accent": true},
        {"step": 4, "note": "G3"},
        {"step": 8, "note": "Eb3", "accent": true},
        {"step": 12, "note": "F3"}
      ],
      "params": {
        "waveform": "303-saw",
        "filterCutoff": 3000,
        "filterResonance": 12,
        "pitchDecay": 0.4
      }
    },
    "kick": [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
    "snare": [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
    "closedHat": [false, true, false, true, false, true, false, true, false, true, false, true, false, true, false, true],
    "openHat": [false, false, false, false, false, false, false, false, false, false, false, false, false, false, true, false]
  },
  "automation": [
    {
      "target": "synthA",
      "parameter": "filterCutoff",
      "steps": [100, null, 110, null, 120, 127, 120, 100, null, null, 100, 110, 120, 127, 120, 100],
      "interpolation": "linear"
    }
  ]
}

RULES:
- Steps are 0-15 for 16-step patterns or 0-31 for 32-step patterns
- Notes use format like "C3", "F#4", "Bb2"
- Drum tracks are boolean arrays (true = hit on that step)
- Tempo range: 30-300 BPM
- Swing: 0-100 (50 = no swing, higher = more shuffle)

AUTOMATION (Optional):
- Add an "automation" array for parameter changes over time
- target: synthA, synthB, bass2, kick, snare, closedHat, openHat, sampler, or master
- parameter: filterCutoff, filterResonance, pitchDecay, volume, delayMix, tempo, etc.
- steps: Array of 16 or 32 values (0-127) or null for no change
- interpolation: "step", "linear", or "smooth" (default: "step")

Generate a {GENRE} song at {TEMPO} BPM with {MOOD} mood.
Return ONLY the JSON, no markdown, no explanation.`;

export const EXAMPLE_TECHNO: AISongData = {
  meta: {
    title: "Warehouse Acid",
    author: "AI Demo",
    version: "1.0",
    createdAt: "2024-03-06T12:00:00Z",
    generator: "claude-3-opus",
    prompt: "Dark warehouse techno",
    tags: ["techno", "acid"]
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
        pitchDecay: 0.4
      }
    },
    kick: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
    snare: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
    closedHat: [false, true, false, true, false, true, false, true, false, true, false, true, false, true, false, true],
    openHat: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, true, false]
  }
};

export const EXAMPLE_HOUSE: AISongData = {
  meta: {
    title: "Funky House",
    author: "AI Demo",
    version: "1.0",
    createdAt: "2024-03-06T12:00:00Z",
    generator: "gemini-pro",
    prompt: "Funky house with swing",
    tags: ["house", "funky"]
  },
  globals: {
    tempo: 124,
    timeSignature: [4, 4],
    swing: 58
  },
  tracks: {
    synthA: {
      notes: [
        {step: 0, note: "C3"},
        {step: 4, note: "E3"},
        {step: 8, note: "G3"},
        {step: 12, note: "B3"}
      ],
      params: {
        waveform: "303-saw",
        filterCutoff: 4000,
        filterResonance: 8
      }
    },
    synthB: {
      notes: [
        {step: 2, note: "G2"},
        {step: 6, note: "A2"},
        {step: 10, note: "B2"},
        {step: 14, note: "D3"}
      ],
      params: {
        waveform: "303-sqr",
        filterCutoff: 2500,
        filterResonance: 12
      }
    },
    kick: [true, false, false, true, false, false, true, false, false, true, false, false, true, false, false, true],
    snare: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
    closedHat: [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false]
  }
};

export const EXAMPLE_DNB: AISongData = {
  meta: {
    title: "Neurofunk Roller",
    author: "AI Demo",
    version: "1.0",
    createdAt: "2024-03-06T12:00:00Z",
    generator: "grok",
    prompt: "Dark drum and bass",
    tags: ["dnb", "neurofunk"]
  },
  globals: {
    tempo: 174,
    timeSignature: [4, 4],
    swing: 50
  },
  tracks: {
    synthA: {
      notes: [
        {step: 0, note: "F2", accent: true},
        {step: 3, note: "F2"},
        {step: 7, note: "Ab2", accent: true},
        {step: 10, note: "Bb2"}
      ],
      params: {
        waveform: "303-saw",
        filterCutoff: 2500,
        filterResonance: 15,
        pitchDecay: 0.3
      }
    },
    bass2: {
      notes: [
        {step: 0, note: "F1"},
        {step: 8, note: "Eb1"}
      ],
      params: {
        waveform: "303-sqr",
        filterCutoff: 1800,
        filterResonance: 20
      }
    },
    kick: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
    snare: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
    closedHat: [false, true, true, false, false, true, true, false, false, true, true, false, false, true, true, false],
    openHat: [false, false, false, false, false, false, false, false, false, false, false, false, true, false, false, false]
  }
};

export const EXAMPLE_AUTOMATION: AISongData = {
  meta: {
    title: "Acid with Filter Sweep",
    author: "AI Demo",
    version: "1.0",
    createdAt: "2024-03-06T12:00:00Z",
    generator: "claude-3-opus",
    prompt: "Acid techno with automated filter",
    tags: ["techno", "acid", "automation"]
  },
  globals: {
    tempo: 132,
    timeSignature: [4, 4],
    swing: 54
  },
  tracks: {
    synthA: {
      notes: [
        {step: 0, note: "C2", velocity: 0.9, accent: true},
        {step: 2, note: "C2"},
        {step: 4, note: "Eb2", accent: true, slide: true},
        {step: 6, note: "F2"},
        {step: 8, note: "C2", accent: true},
        {step: 10, note: "C2"},
        {step: 12, note: "G2", accent: true, slide: true},
        {step: 14, note: "Bb2"}
      ],
      params: {
        waveform: "303-saw",
        filterCutoff: 800,
        filterResonance: 20,
        pitchDecay: 0.4
      }
    },
    synthB: {
      notes: [
        {step: 4, note: "C3", velocity: 0.7},
        {step: 12, note: "G3", velocity: 0.7}
      ],
      params: {
        waveform: "303-sqr",
        filterCutoff: 2000,
        filterResonance: 15,
        delayMix: 0.3
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
    ],
    openHat: [
      false, false, false, false, false, false, false, false,
      false, false, false, false, false, false, true, false
    ]
  },
  automation: [
    {
      target: 'synthA',
      parameter: 'filterCutoff',
      steps: [
        80, 90, 100, 110, 120, 127, 120, 110,
        100, 90, 100, 110, 120, 127, 120, 100
      ],
      interpolation: 'linear'
    },
    {
      target: 'synthB',
      parameter: 'delayMix',
      steps: [
        0, 10, 20, 30, 40, 50, 60, 70,
        80, 90, 100, 100, 100, 90, 80, 70
      ],
      interpolation: 'smooth'
    }
  ]
};

export const EXAMPLES = {
  techno: { name: "🎛️ Techno Acid (130 BPM)", data: EXAMPLE_TECHNO, emoji: "🎛️", desc: "Dark warehouse acid" },
  house: { name: "🎹 House Groove (124 BPM)", data: EXAMPLE_HOUSE, emoji: "🎹", desc: "Funky house with swing" },
  dnb: { name: "🥁 DnB Roller (174 BPM)", data: EXAMPLE_DNB, emoji: "🥁", desc: "Dark neurofunk DnB" },
  automation: { name: "🎚️ Filter Sweep (132 BPM)", data: EXAMPLE_AUTOMATION, emoji: "🎚️", desc: "With automation lanes" }
};
