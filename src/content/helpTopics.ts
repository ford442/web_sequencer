/**
 * Searchable in-app help catalog.
 * Powers the Help modal command palette and contextual ? tooltips.
 */

export type HelpCategory =
  | 'engine'
  | 'automation'
  | 'sampler'
  | 'import'
  | 'song'
  | 'voice'
  | 'general';

export interface HelpTopic {
  id: string;
  title: string;
  /** One-line answer for search results and tooltips. */
  summary: string;
  /** Expanded guidance (plain text, short paragraphs separated by blank lines). */
  body: string;
  keywords: string[];
  category: HelpCategory;
  /** Ordered steps for workflow topics. */
  steps?: string[];
  /** External or in-repo doc path. */
  docLink?: string;
}

export const HELP_CATEGORY_LABELS: Record<HelpCategory, string> = {
  engine: 'Engines & synthesis',
  automation: 'Automation',
  sampler: 'Sampler & TTS',
  import: 'Import & export',
  song: 'Song mode',
  voice: 'Voice designer',
  general: 'General',
};

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: 'engine-303-switch',
    title: '303 Voice selector (Open303 / JC303 / high-fid)',
    summary:
      'Pick a 303 waveform, then choose a voice in the 303 Voice panel — Stock Open303, Authentic JC303, character profiles, or offline high-fidelity.',
    body:
      'Each 303 track (SYNTH A lead, SYNTH B, BASS 2) picks a voice independently via the 303 Voice selector.\n\n' +
      'Realtime voices: Stock Open303, Authentic JC303, and open303 coefficient profiles (1ink303, Experimental, ReBirth-inspired, MB33, Raveolution).\n\n' +
      'Offline high-fid voices (amber Offline badge): High-Fidelity CPU and GPU High-Fidelity. Live playback stays on Stock Open303; the selected id is used for freeze / export / multisample. Without WebGPU, a No GPU badge appears and GPU High-Fidelity falls back to High-Fidelity CPU.',
    keywords: [
      '303',
      'jc303',
      'open303',
      'tb-303',
      'authentic',
      'engine',
      'switch',
      'bass',
      'synth',
      'voice',
      'highfid',
      'high-fidelity',
      'gpu',
      'offline',
      'hifid',
    ],
    category: 'engine',
    steps: [
      'Select SYNTH A, SYNTH B, or BASS 2 in the rack.',
      'Choose a 303-saw or 303-sqr waveform variant.',
      'In 303 Voice, tap Stock Open303, Authentic JC303, a character profile, or an Offline high-fid voice.',
      'Play for realtime; use freeze / export / multisample to hear high-fid engines.',
    ],
    docLink: 'docs/audio-engine/303-gpu-highfid.md',
  },
  {
    id: 'highfid-303-offline',
    title: 'High-fidelity 303 (offline)',
    summary:
      'Opt-in High-Fidelity CPU / GPU voices for freeze, export, and multisample — live play stays latency-safe on Stock Open303.',
    body:
      'High-fidelity models close authenticity gaps with a diode-ladder topology (CPU OpenMP or WebGPU WGSL). They are offline-only so the AudioWorklet never regresses.\n\n' +
      'Select High-Fidelity CPU (offline) or GPU High-Fidelity (offline) in 303 Voice. Status shows the effective offline engine; No GPU means WebGPU is missing and GPU selections fall back to CPU. Engine HUD (Ctrl+Shift+E) shows Offline 303 oversample, threads, and GPU telemetry.',
    keywords: [
      'highfid',
      'high-fidelity',
      'gpu-highfid',
      'webgpu',
      'offline',
      'freeze',
      'export',
      'multisample',
      'oversample',
      'diode',
      'ladder',
      '303',
    ],
    category: 'engine',
    steps: [
      'Open SYNTH A, SYNTH B, or BASS 2 and select a 303-* waveform.',
      'In 303 Voice, choose High-Fidelity CPU (offline) or GPU High-Fidelity (offline).',
      'Confirm the status line (offline engine + live uses Stock Open303).',
      'Run freeze, WAV export, or 303 multisample generation to use the authenticity tier.',
    ],
    docLink: 'docs/audio-engine/303-gpu-highfid.md',
  },
  {
    id: 'highfid-303-live',
    title: 'Live high-fidelity 303',
    summary:
      'Play the diode-ladder high-fid voice in real time — it steps back to Stock Open303 rather than glitching when CPU runs short.',
    body:
      'Live High-Fidelity runs the same diode-ladder topology as the offline high-fid voices, inside the AudioWorklet at 1x oversample, so you can A/B authenticity while the sequencer plays.\n\n' +
      'A CPU meter watches the voice on the audio thread. If it uses too much of the audio budget for too long, or causes repeated underruns, it hands playback back to Stock Open303 and tells you why — check Engine HUD (Ctrl+Shift+E) under Live 303 path to see which engine is audible. Freeze and export of the same part render through High-Fidelity CPU, so a bounce matches what you heard.',
    keywords: [
      'live',
      'realtime',
      'highfid',
      'high-fidelity',
      'live-highfid',
      'diode',
      'ladder',
      'cpu',
      'budget',
      'degrade',
      'fallback',
      '303',
    ],
    category: 'engine',
    steps: [
      'Open SYNTH A, SYNTH B, or BASS 2 and select a 303-* waveform.',
      'In 303 Voice, choose Live High-Fidelity (amber Live pill).',
      'Play — Engine HUD shows LIVE HIFID and the rolling CPU share.',
      'If it shows stock (degraded), the CPU gate stepped in; the reason is listed next to it.',
    ],
    docLink: 'docs/audio-engine/303-realtime-highfid.md',
  },
  {
    id: 'prophecy-formants',
    title: 'Prophecy formant waveforms',
    summary: 'Select prophecy-* waves on SYNTH A/B, then use the Vowel / Formant / Portamento panel.',
    body:
      'Prophecy-style formant oscillators (prophecy-saw, prophecy-sqr, prophecy-tri, prophecy-pulse) route through the Prophecy worklet in hyphon_native.wasm.\n\n' +
      'After selecting a prophecy waveform, the Prophecy panel appears with vowel presets (A/E/I/O/U), formant shift, and portamento.',
    keywords: [
      'prophecy', 'formant', 'vowel', 'portamento', 'korg', 'voice', 'synth',
    ],
    category: 'engine',
    steps: [
      'On SYNTH A or SYNTH B, pick an oscillator type that includes Prophecy variants.',
      'Select a prophecy-* waveform.',
      'Adjust Vowel buttons for formant character.',
      'Use Formant Shift and Portamento sliders for expression.',
    ],
    docLink: 'docs/audio-engine/jc303-prophecy.md',
  },
  {
    id: 'automation-filter',
    title: 'Automate a filter (or any knob)',
    summary: 'Right-click a hardware knob → enable lane, press Play, move the knob while REC AUTO is on.',
    body:
      'Hardware knobs on each rack module support per-parameter automation lanes stored in the song.\n\n' +
      'Enable a lane from the knob context menu, turn on REC AUTO in the bottom bar while playing, then move the knob to record movement. Use AUTO VIEW to see ghost curves on knobs.',
    keywords: [
      'automate', 'automation', 'filter', 'cutoff', 'lane', 'record', 'knob', 'pcf',
    ],
    category: 'automation',
    steps: [
      'Open the rack module (e.g. SYNTH A) and find the target knob.',
      'Right-click the knob → Toggle lane (or use the panel AUTO button).',
      'Press Play, then enable REC AUTO in the bottom bar.',
      'Move the knob while the sequencer runs — points are captured per step.',
      'Toggle AUTO VIEW to preview curves; Alt+drag nudges points at the playhead.',
    ],
    docLink: 'docs/automation.md',
  },
  {
    id: 'automation-rec-auto',
    title: 'REC AUTO — live automation recording',
    summary: 'Bottom bar REC AUTO arms capture while the transport is playing.',
    body:
      'REC AUTO records knob movements into enabled automation lanes during playback. Lanes must be armed first (per knob or via the module header AUTO control).\n\n' +
      'Recording is disabled when stopped — start playback first.',
    keywords: ['rec auto', 'record', 'automation', 'live', 'lane'],
    category: 'automation',
    steps: [
      'Enable automation lanes on the parameters you want to move.',
      'Press Play.',
      'Click REC AUTO in the bottom bar (it pulses while active).',
      'Twist hardware knobs — values are written per sequencer step.',
      'Click REC AUTO again to stop capturing.',
    ],
  },
  {
    id: 'rbs-import',
    title: 'Import ReBirth .rbs files',
    summary: 'Bottom bar → Import .rbs opens the RBS import wizard for RB-338 patterns.',
    body:
      'Hyphon can import ReBirth Song (.rbs) files, mapping TB-303 patterns, drum tracks, and automation into Hyphon lanes.\n\n' +
      'Use the import modal to preview patterns, choose PCF→automation conversion, and review the import report before applying.',
    keywords: ['rbs', 'rebirth', 'rb-338', 'import', '338', 'rebirth'],
    category: 'import',
    steps: [
      'Click Import .rbs in the bottom bar.',
      'Choose a .rbs file from disk.',
      'Review pattern mapping and automation options.',
      'Confirm import — patterns load into the current song slots.',
    ],
    docLink: 'docs/automation.md',
  },
  {
    id: 'ai-song-import',
    title: 'Import AI-generated songs',
    summary: 'Bottom bar → Import AI Song accepts JSON from Claude, Gemini, and other AI composers.',
    body:
      'The AI Song modal validates and converts structured JSON into Hyphon patterns, parameters, and metadata.\n\n' +
      'Paste or upload JSON, review track statistics, then import into the current project.',
    keywords: ['ai', 'import', 'song', 'claude', 'gemini', 'json'],
    category: 'import',
    steps: [
      'Click Import AI Song in the bottom bar.',
      'Paste JSON or pick a file.',
      'Review validation and track breakdown.',
      'Import — patterns merge into the active project.',
    ],
  },
  {
    id: 'sampler-tts',
    title: 'Sampler text-to-speech (TTS)',
    summary: 'Select a bank, type a phrase, press GEN. Each of 8 banks stores its own phrase.',
    body:
      'Supertonic ONNX TTS runs in-browser when models are installed (see docs/tts). Each sample bank has an independent TTS phrase saved with your project.\n\n' +
      'The green LED beside GEN means the engine is ready. Use EDIT to open the Voice Designer for timbre shaping.',
    keywords: ['tts', 'text', 'speech', 'sampler', 'supertonic', 'voice', 'gen', 'phrase'],
    category: 'sampler',
    steps: [
      'Select the Sampler track and pick a bank (1–8).',
      'Type text in the phrase field.',
      'Wait for the green ready LED (models load on first use).',
      'Press GEN — audio is rendered into the active bank.',
      'Trigger from the sequencer or live keyboard.',
    ],
    docLink: 'docs/tts/TTS_DEPLOYMENT.md',
  },
  {
    id: 'voice-designer',
    title: 'Voice Designer',
    summary: 'Sampler → EDIT opens the real-time voice parameter editor with GPU DSP.',
    body:
      'The Voice Designer provides sharpen, echo, tremolo, jitter, and geometric transforms on TTS output.\n\n' +
      'Changes apply to the active bank and are saved with your project.',
    keywords: ['voice', 'designer', 'edit', 'dsp', 'gpu', 'timbre'],
    category: 'voice',
    steps: [
      'Open the Sampler rack module.',
      'Click EDIT next to the TTS controls.',
      'Adjust parameters — preview updates in real time.',
      'Close the editor — settings persist per bank.',
    ],
    docLink: 'docs/tts/TTS_VISUAL_GUIDE.md',
  },
  {
    id: 'song-mode',
    title: 'Song mode — arrange patterns',
    summary: 'Transport SONG button opens the arrangement grid across measures and tracks.',
    body:
      'Song mode lets you place pattern slot numbers (1–8) into a measure × track grid for full arrangements.\n\n' +
      'Toggle Song Mode Active to follow the song structure during playback instead of looping a single pattern.',
    keywords: ['song', 'mode', 'arrange', 'pattern', 'measure', 'structure'],
    category: 'song',
    steps: [
      'Click SONG in the transport toolbar.',
      'Click cells to assign pattern slot numbers per track.',
      'Use arrow keys to navigate; Enter toggles values.',
      'Enable Song Mode Active to play the arrangement.',
      'Export to XM from the song panel when finished.',
    ],
  },
  {
    id: 'session-launcher',
    title: 'Session / clip launcher',
    summary: 'CLIP opens a scene grid. Launch clips per track or whole scenes, quantized to the audio clock.',
    body:
      'Session is a live clip launcher. It uses the same transport as the sequencer — launches wait for the selected quantization (step, beat, bar, 2/4 bars) on the audio timeline.\n\n' +
      'CAPTURE records your launches into Song Mode. Right-click a cell to MIDI-learn. Gamepad D-pad navigates; Attack launches a clip, Jump launches a scene.\n\n' +
      'See docs/session-launcher.md for conflict rules and control ids.',
    keywords: ['session', 'clip', 'launcher', 'scene', 'live', 'quantize', 'capture'],
    category: 'song',
    steps: [
      'Click CLIP in the transport toolbar.',
      'Load a starter pack or use clips mapped to pattern slots.',
      'Press Play, then launch a scene or individual clips.',
      'Optional: CAPTURE, then replay from Song Mode.',
    ],
    docLink: 'docs/session-launcher.md',
  },
  {
    id: 'midi-learn',
    title: 'MIDI learn & mapping',
    summary: 'Toolbar MIDI toggles learn mode; touch a knob then move a controller to bind.',
    body:
      'MIDI Learn maps CCs and notes to hardware knobs and master sliders. Open MAP in the toolbar for an overview and to clear bindings.',
    keywords: ['midi', 'learn', 'map', 'controller', 'cc'],
    category: 'general',
    steps: [
      'Enable MIDI in the transport toolbar.',
      'Touch or long-press a knob to select it as the learn target.',
      'Move a MIDI control — binding is stored automatically.',
      'Open MAP to review or clear mappings.',
    ],
  },
  {
    id: 'shortcuts-overview',
    title: 'Keyboard shortcuts',
    summary: 'Press ? or click Help in the bottom bar. Space = play, Ctrl+C/V = copy/paste steps.',
    body: 'Open the Shortcuts tab in Help for the full list grouped by area.',
    keywords: ['keyboard', 'shortcut', 'help', 'hotkey', '?'],
    category: 'general',
  },
];

export function getHelpTopic(id: string): HelpTopic | undefined {
  return HELP_TOPICS.find((t) => t.id === id);
}

export function searchHelpTopics(query: string): HelpTopic[] {
  const q = query.trim().toLowerCase();
  if (!q) return HELP_TOPICS;
  return HELP_TOPICS.filter((topic) => {
    const haystack = [
      topic.title,
      topic.summary,
      topic.body,
      ...topic.keywords,
      HELP_CATEGORY_LABELS[topic.category],
    ]
      .join(' ')
      .toLowerCase();
    return q.split(/\s+/).every((word) => haystack.includes(word));
  });
}

/** Checklist items shown in the dismissible What's New banner. */
export const WHATS_NEW_ITEMS = [
  { id: 'highfid-303-offline', label: 'High-fidelity 303 (offline CPU / GPU)' },
  { id: 'engine-303-switch', label: '303 Voice selector (Open303 / JC303 / high-fid)' },
  { id: 'prophecy-formants', label: 'Prophecy formant oscillators' },
  { id: 'automation-filter', label: 'Knob automation lanes + REC AUTO' },
  { id: 'rbs-import', label: 'ReBirth .rbs import' },
  { id: 'sampler-tts', label: 'Per-bank sampler TTS' },
  { id: 'voice-designer', label: 'Voice Designer DSP editor' },
  { id: 'song-mode', label: 'Song mode arrangement' },
] as const;

/** Bump when adding major features to re-show the What's New banner. */
export const HELP_WHATS_NEW_VERSION = '2026.07-highfid';
